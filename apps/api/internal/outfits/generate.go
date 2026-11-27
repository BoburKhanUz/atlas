// Package outfits is the outfit use cases: outfits generated from the
// user's own wardrobe by the engine, and the saved outfits with their
// feedback.
package outfits

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/engine"
	"lookly/internal/store"
	"lookly/internal/wardrobe"
	"lookly/internal/weather"
)

const (
	// FeedbackDays is how far back feedback shapes the outfits.
	FeedbackDays = 30
	// DefaultTopN is how many outfits are made when the request says nothing.
	DefaultTopN = 3
	// wardrobeRows bounds what is read of a wardrobe: above what one may hold.
	wardrobeRows = 2 * wardrobe.MaxItems
	// feedbackRows bounds how many (outfit, kind of feedback) pairs are read.
	feedbackRows = 2000
)

// Forecasts is where the weather of a place comes from (weather.Service).
type Forecasts interface {
	Current(ctx context.Context, lat, lon float64) (weather.Report, error)
}

// Service is the outfit use cases.
type Service struct {
	pool      *pgxpool.Pool
	forecasts Forecasts
	log       *slog.Logger
}

// New returns the service over the pool; forecasts answers the weather of a
// place for a generation that brings coordinates and no weather.
func New(pool *pgxpool.Pool, forecasts Forecasts, log *slog.Logger) *Service {
	return &Service{pool: pool, forecasts: forecasts, log: log}
}

// GenerateRequest is a request for outfits. Everything is optional.
type GenerateRequest struct {
	Occasion *string
	// Weather is the client's own weather snapshot; without it, Lat and Lon
	// say where to ask the weather for.
	Weather  *engine.Weather
	Lat, Lon *float64
	// Seed picks a window of the best outfits ("another option"); TopN is
	// how many are wanted (DefaultTopN when nil).
	Seed, TopN *float64
}

// Generated is the answer: the outfits, or why there are none.
type Generated struct {
	Outfits []Outfit
	// WeatherUsed is the weather the outfits were made for; nil: none.
	WeatherUsed       *engine.Weather
	WardrobeItemCount int
	// Fallback: the order and the explanations are the engine's own (always,
	// until the AI ranking of stage B6).
	Fallback bool
	// Message says why there are no outfits.
	Message string
}

// Outfit is one generated outfit with its explanation and, for each piece
// in order, the item's primary image (nil when it has none).
type Outfit struct {
	engine.Candidate
	Explanation string
	Images      []*wardrobe.Image
}

// list reads a stored JSON list of texts; what is not one is empty, as in
// the Next.js route (one bad row does not stop the outfits).
func list(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil || values == nil {
		return []string{}
	}
	return values
}

// read is what a generation reads of the database.
type read struct {
	wardrobe []engine.Item
	profile  engine.Profile
	colors   *engine.ColorProfile
	feedback engine.Feedback
}

// Generate makes outfits from the user's wardrobe for the request's
// occasion and weather. Nothing is stored.
func (s *Service) Generate(ctx context.Context, userID string, request GenerateRequest) (Generated, error) {
	var data read
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) (err error) {
		data, err = load(ctx, store.New(tx), userID)
		return err
	})
	if err != nil {
		return Generated{}, fmt.Errorf("outfits: generate: %w", err)
	}

	// The weather: the client's snapshot, else the weather of the place,
	// else none. An empty wardrobe needs no weather.
	conditions := request.Weather
	if conditions == nil && request.Lat != nil && request.Lon != nil && len(data.wardrobe) > 0 {
		report, err := s.forecasts.Current(ctx, *request.Lat, *request.Lon)
		switch {
		case err == nil:
			conditions = &engine.Weather{
				Temperature: &report.Temperature, FeelsLike: &report.FeelsLike, Condition: &report.Condition,
				PrecipitationProbability: &report.PrecipitationProbability, Humidity: &report.Humidity,
				WindSpeed: &report.WindSpeed, UVIndex: &report.UVIndex,
			}
		case ctx.Err() != nil:
			return Generated{}, fmt.Errorf("outfits: generate: %w", ctx.Err())
		default:
			// Outfits without the weather are better than no outfits.
			s.log.WarnContext(ctx, "outfits: the weather could not be had; outfits are made without it", "err", err.Error())
		}
	}

	in := engine.Input{
		Wardrobe: data.wardrobe, Weather: conditions, Profile: &data.profile, ColorProfile: data.colors, Feedback: &data.feedback,
		TopN: request.TopN, Seed: request.Seed,
	}
	if request.Occasion != nil {
		in.Occasion = *request.Occasion
	}
	if in.TopN == nil {
		n := float64(DefaultTopN)
		in.TopN = &n
	}
	result := engine.Generate(in)

	generated := Generated{WeatherUsed: conditions, WardrobeItemCount: len(data.wardrobe), Fallback: true, Outfits: []Outfit{}}
	if len(result.Outfits) == 0 {
		problem := result.Problem
		if problem == "" {
			problem = engine.NothingSuitable
		}
		generated.Message = problem.Message()
		return generated, nil
	}

	images, err := s.primaryImages(ctx, result.Outfits)
	if err != nil {
		return Generated{}, fmt.Errorf("outfits: generate: %w", err)
	}
	for _, candidate := range result.Outfits {
		outfit := Outfit{Candidate: candidate, Explanation: engine.Explanation(candidate, in.Occasion, result.Weather)}
		for _, piece := range candidate.Items {
			outfit.Images = append(outfit.Images, images[piece.Item.ID])
		}
		generated.Outfits = append(generated.Outfits, outfit)
	}
	return generated, nil
}

// load reads the wardrobe, the preferences, the colour profile and the
// recent feedback of a user.
func load(ctx context.Context, q *store.Queries, userID string) (read, error) {
	var data read
	rows, err := q.WardrobeForOutfits(ctx, store.WardrobeForOutfitsParams{UserID: userID, RowLimit: wardrobeRows})
	if err != nil {
		return read{}, fmt.Errorf("wardrobe: %w", err)
	}
	data.wardrobe = make([]engine.Item, 0, len(rows))
	for _, r := range rows {
		data.wardrobe = append(data.wardrobe, engine.Item{
			ID: r.ID, Category: r.Category, Subcategory: r.Subcategory, Colors: list(r.Colors), Pattern: r.Pattern,
			Material: r.Material, SleeveLength: r.SleeveLength, Fit: r.Fit, Style: r.Style, Season: list(r.Season),
			Gender: r.Gender, Formality: r.Formality,
		})
	}

	// The profile and the preferences: a user may have neither row.
	data.profile = engine.Profile{PreferredStyles: []string{}, DislikedStyles: []string{}, FavoriteColors: []string{}, DislikedColors: []string{}}
	switch profile, err := q.UserProfileByUser(ctx, userID); {
	case err == nil:
		data.profile.Gender, data.profile.PreferredFit = profile.Gender, profile.PreferredFit
	case !errors.Is(err, pgx.ErrNoRows):
		return read{}, fmt.Errorf("profile: %w", err)
	}
	switch preferences, err := q.UserPreferencesByUser(ctx, userID); {
	case err == nil:
		data.profile.PreferredStyles, data.profile.DislikedStyles = list(preferences.PreferredStyles), list(preferences.DislikedStyles)
		data.profile.FavoriteColors, data.profile.DislikedColors = list(preferences.FavoriteColors), list(preferences.DislikedColors)
	case !errors.Is(err, pgx.ErrNoRows):
		return read{}, fmt.Errorf("preferences: %w", err)
	}
	// The stored colour profile; never made up when there is none.
	switch colors, err := q.ColorProfileOfUser(ctx, userID); {
	case err == nil:
		data.colors = &engine.ColorProfile{
			Season: colors.Season, SecondarySeason: colors.SecondarySeason, Undertone: colors.Undertone,
			Confidence: colors.Confidence, UndertoneConfidence: colors.UndertoneConfidence, SecondaryConfidence: colors.SecondaryConfidence,
			RecommendedColors: list(colors.RecommendedColors), NeutralColors: list(colors.NeutralColors), CautionColors: list(colors.CautionColors),
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return read{}, fmt.Errorf("colour profile: %w", err)
	}

	data.feedback, err = recentFeedback(ctx, q, userID)
	if err != nil {
		return read{}, fmt.Errorf("feedback: %w", err)
	}
	return data, nil
}

// recentFeedback is what the feedback of the last FeedbackDays days says:
// the items of liked and saved outfits, the items of disliked and rejected
// ones, and those outfits' main compositions.
func recentFeedback(ctx context.Context, q *store.Queries, userID string) (engine.Feedback, error) {
	given, err := q.RecentOutfitFeedback(ctx, store.RecentOutfitFeedbackParams{UserID: userID, Days: FeedbackDays, RowLimit: feedbackRows})
	if err != nil {
		return engine.Feedback{}, err
	}
	feedback := engine.Feedback{RejectedItemIDs: []string{}, LikedItemIDs: []string{}, RejectedOutfitKeys: []string{}}
	if len(given) == 0 {
		return feedback, nil
	}
	var outfitIDs []string
	for _, f := range given {
		if !slices.Contains(outfitIDs, f.OutfitId) {
			outfitIDs = append(outfitIDs, f.OutfitId)
		}
	}
	items, err := q.ItemsOfOutfits(ctx, store.ItemsOfOutfitsParams{UserID: userID, OutfitIds: outfitIDs})
	if err != nil {
		return engine.Feedback{}, err
	}
	byOutfit := map[string][]store.ItemsOfOutfitsRow{}
	for _, item := range items {
		byOutfit[item.OutfitId] = append(byOutfit[item.OutfitId], item)
	}
	add := func(set *[]string, value string) {
		if !slices.Contains(*set, value) {
			*set = append(*set, value)
		}
	}
	for _, f := range given {
		pieces := byOutfit[f.OutfitId]
		switch f.Feedback {
		case "disliked", "rejected":
			var main []engine.KeyPiece
			for _, p := range pieces {
				add(&feedback.RejectedItemIDs, p.ItemID)
				if slot := engine.SlotOf(p.Category); slot != "" && slot != engine.Accessory {
					main = append(main, engine.KeyPiece{ID: p.ItemID, Slot: slot})
				}
			}
			if len(main) > 0 {
				add(&feedback.RejectedOutfitKeys, engine.Key(main))
			}
		case "liked", "saved":
			for _, p := range pieces {
				add(&feedback.LikedItemIDs, p.ItemID)
			}
		}
	}
	slices.Sort(feedback.RejectedItemIDs)
	slices.Sort(feedback.LikedItemIDs)
	slices.Sort(feedback.RejectedOutfitKeys)
	return feedback, nil
}

// primaryImages is the primary image (else the first) of each item of the
// outfits that has one, by item id.
func (s *Service) primaryImages(ctx context.Context, outfits []engine.Candidate) (map[string]*wardrobe.Image, error) {
	var ids []string
	for _, outfit := range outfits {
		for _, piece := range outfit.Items {
			if !slices.Contains(ids, piece.Item.ID) {
				ids = append(ids, piece.Item.ID)
			}
		}
	}
	rows, err := store.New(s.pool).WardrobeImagesOfItems(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("images: %w", err)
	}
	images := map[string]*wardrobe.Image{}
	for _, r := range rows {
		if current, has := images[r.WardrobeItemId]; has && (current.IsPrimary || !r.IsPrimary) {
			continue // the first primary image, or the first image while no primary is seen
		}
		images[r.WardrobeItemId] = &wardrobe.Image{
			ID: r.ID, StorageKey: r.StorageKey, DisplayKey: r.DisplayKey, ThumbnailKey: r.ThumbnailKey,
			IsPrimary: r.IsPrimary, Width: r.Width, Height: r.Height,
		}
	}
	return images, nil
}
