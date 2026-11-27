package outfits

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"lookly/internal/engine"
	"lookly/internal/platform"
	"lookly/internal/store"
	"lookly/internal/wardrobe"
)

// ListLimit is how many outfits a list holds: the newest.
const ListLimit = 50

var (
	// ErrNotFound: the user has no such outfit.
	ErrNotFound = errors.New("outfits: no such outfit")
	// ErrNotOwned: an item to save is not an item of the user's.
	ErrNotOwned = errors.New("outfits: an item is not the user's")
)

// RoleError: the role of the item at Index is none an outfit item may have
// (Unknown), or none an item of its kind may have. Allowed are the roles
// it may have.
type RoleError struct {
	Index   int
	Unknown bool
	Allowed []string
}

func (e *RoleError) Error() string {
	return fmt.Sprintf("outfits: the role of item %d is not allowed", e.Index)
}

// CompositionError: the items are no outfit.
type CompositionError struct{ Problem engine.CompositionError }

func (e *CompositionError) Error() string { return "outfits: " + string(e.Problem) }

// SaveItem is an item of an outfit to save, with its role.
type SaveItem struct{ ItemID, Role string }

// WeatherSnapshot is the weather an outfit was made for, as the client
// brought it.
type WeatherSnapshot struct {
	Temperature              float64 `json:"temperature"`
	FeelsLike                float64 `json:"feelsLike"`
	Condition                string  `json:"condition"`
	PrecipitationProbability float64 `json:"precipitationProbability"`
	Humidity                 float64 `json:"humidity"`
	WindSpeed                float64 `json:"windSpeed"`
	UVIndex                  float64 `json:"uvIndex"`
}

// SaveRequest is an outfit to store: its items, and what the generation
// said of it (stored as given, not worked out again).
type SaveRequest struct {
	Items       []SaveItem
	Occasion    *string
	Weather     *WeatherSnapshot
	Name        *string
	Score       *float64
	Reasons     []string
	Explanation *string
	IsSaved     bool
}

// Row is a stored outfit without its items, as the database row holds it.
type Row struct {
	ID       string
	UserID   string
	Name     *string
	Occasion *string
	// WeatherSnapshot and ReasonsJSON are the stored texts (JSON).
	WeatherSnapshot *string
	Score           *int32
	ReasonsJSON     string
	Explanation     *string
	IsSaved         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func rowOf(o store.Outfit) Row {
	return Row{
		ID: o.ID, UserID: o.UserId, Name: o.Name, Occasion: o.Occasion, WeatherSnapshot: o.WeatherSnapshot, Score: o.Score,
		ReasonsJSON: o.ReasonsJson, Explanation: o.Explanation, IsSaved: o.IsSaved, CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt,
	}
}

// Link is an item's place in an outfit.
type Link struct {
	ID             string
	OutfitID       string
	WardrobeItemID string
	Role           *string
	CreatedAt      time.Time
}

// Saved is an outfit as it was stored.
type Saved struct {
	Row
	Items []Link
}

// Garment is an item of a stored outfit with what is shown of it.
type Garment struct {
	Link
	Category    string
	Subcategory *string
	Colors      []string
	Style       *string
	Material    *string
	Season      []string
	// Images are the item's images in the order they were added.
	Images []wardrobe.Image
}

// Stored is a stored outfit with its items.
type Stored struct {
	Row
	Reasons []string
	// Weather is the weather snapshot, a JSON object ("{}" when none).
	Weather  json.RawMessage
	Garments []Garment
}

// jsText is JSON.stringify of a value: Go's encoding without its escaping
// of <, > and &.
func jsText(v any) (string, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return "", err
	}
	return string(bytes.TrimSuffix(b.Bytes(), []byte("\n"))), nil
}

// Save stores an outfit of the user's own items, when they are an outfit:
// known roles, no item twice, every item the user's, each role one its
// item's kind may have, and a valid composition; in this order, as the
// Next.js route judged them.
func (s *Service) Save(ctx context.Context, userID string, request SaveRequest) (Saved, error) {
	roles := engine.SaveRoles()
	ids := make([]string, 0, len(request.Items))
	for i, item := range request.Items {
		if !slices.Contains(roles, item.Role) {
			return Saved{}, &RoleError{Index: i, Unknown: true, Allowed: roles}
		}
		ids = append(ids, item.ItemID)
	}
	for i, id := range ids {
		if slices.Contains(ids[:i], id) {
			return Saved{}, &CompositionError{engine.DuplicateItem}
		}
	}
	weather, reasons := "{}", "[]"
	var err error
	if request.Weather != nil {
		if weather, err = jsText(request.Weather); err != nil {
			return Saved{}, fmt.Errorf("outfits: save: the weather: %w", err)
		}
	}
	if request.Reasons != nil {
		if reasons, err = jsText(request.Reasons); err != nil {
			return Saved{}, fmt.Errorf("outfits: save: the reasons: %w", err)
		}
	}
	insert := store.InsertOutfitParams{
		ID: platform.NewID(), UserID: userID, Occasion: request.Occasion, WeatherSnapshot: &weather, ReasonsJson: reasons,
		Explanation: request.Explanation, IsSaved: request.IsSaved,
	}
	if request.Name != nil && *request.Name != "" {
		insert.Name = request.Name
	}
	if request.Score != nil {
		score := int32(platform.RoundHalfUp(*request.Score))
		insert.Score = &score
	}

	var saved Saved
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		owned, err := q.LockItemsForOutfit(ctx, store.LockItemsForOutfitParams{Ids: ids, UserID: userID})
		if err != nil {
			return fmt.Errorf("the items: %w", err)
		}
		if len(owned) != len(ids) {
			return ErrNotOwned
		}
		categories := make(map[string]string, len(owned))
		for _, item := range owned {
			categories[item.ID] = item.Category
		}
		composition := make([]engine.CompositionItem, 0, len(ids))
		for i, item := range request.Items {
			category := categories[item.ItemID]
			// A kind that has no place in an outfit is the composition's to refuse.
			if slot := engine.SlotOf(category); slot != "" && !slices.Contains(engine.RolesFor(slot), item.Role) {
				return &RoleError{Index: i, Allowed: engine.RolesFor(slot)}
			}
			composition = append(composition, engine.CompositionItem{ID: item.ItemID, Category: category})
		}
		if problem := engine.ValidateComposition(composition); problem != "" {
			return &CompositionError{problem}
		}

		row, err := q.InsertOutfit(ctx, insert)
		if err != nil {
			return fmt.Errorf("the outfit: %w", err)
		}
		saved = Saved{Row: rowOf(row), Items: make([]Link, 0, len(request.Items))}
		for i, item := range request.Items {
			link, err := q.InsertOutfitItem(ctx, store.InsertOutfitItemParams{
				ID: platform.NewID(), OutfitID: row.ID, WardrobeItemID: item.ItemID, Role: &item.Role, Place: int32(i),
			})
			if err != nil {
				return fmt.Errorf("item %d: %w", i, err)
			}
			saved.Items = append(saved.Items, Link{
				ID: link.ID, OutfitID: link.OutfitId, WardrobeItemID: link.WardrobeItemId, Role: link.Role, CreatedAt: link.CreatedAt,
			})
		}
		return nil
	})
	if err != nil {
		return Saved{}, fmt.Errorf("outfits: save: %w", err) // a refusal (ErrNotOwned, *RoleError, *CompositionError) is in the chain
	}
	return saved, nil
}

// List is the user's newest outfits (ListLimit at most), all or only the
// saved ones, with their items.
func (s *Service) List(ctx context.Context, userID string, savedOnly bool) ([]Stored, error) {
	var outfits []Stored
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := store.New(tx)
		rows, err := q.ListOutfits(ctx, store.ListOutfitsParams{UserID: userID, SavedOnly: savedOnly, RowLimit: ListLimit})
		if err != nil {
			return err
		}
		outfits, err = withGarments(ctx, q, userID, rows)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("outfits: list: %w", err)
	}
	return outfits, nil
}

// Get is one outfit of the user's with its items; ErrNotFound (in the
// error's chain) otherwise.
func (s *Service) Get(ctx context.Context, userID, id string) (Stored, error) {
	var outfits []Stored
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := store.New(tx)
		row, err := q.OutfitOfUser(ctx, store.OutfitOfUserParams{ID: id, UserId: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		outfits, err = withGarments(ctx, q, userID, []store.Outfit{row})
		return err
	})
	if err != nil {
		return Stored{}, fmt.Errorf("outfits: get %s: %w", id, err)
	}
	return outfits[0], nil
}

// texts reads a stored JSON list of texts; anything else is an error
// (the row was not written by us).
func texts(raw string) ([]string, error) {
	var values []string
	d := json.NewDecoder(bytes.NewReader([]byte(raw)))
	if err := d.Decode(&values); err != nil {
		return nil, err
	}
	if values == nil || d.More() {
		return nil, errors.New("not a JSON list")
	}
	return values, nil
}

// withGarments reads the outfits' items, their garments and those
// garments' images.
func withGarments(ctx context.Context, q *store.Queries, userID string, rows []store.Outfit) ([]Stored, error) {
	outfits := make([]Stored, 0, len(rows))
	index := make(map[string]int, len(rows))
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		reasons, err := texts(row.ReasonsJson)
		if err != nil {
			return nil, fmt.Errorf("outfit %s: the stored reasons: %w", row.ID, err)
		}
		// The weather: a JSON object, "{}" when nothing was stored.
		weather := json.RawMessage("{}")
		if row.WeatherSnapshot != nil && *row.WeatherSnapshot != "" {
			var object map[string]json.RawMessage
			if err := json.Unmarshal([]byte(*row.WeatherSnapshot), &object); err != nil || object == nil {
				return nil, fmt.Errorf("outfit %s: the stored weather is not a JSON object", row.ID)
			}
			weather = json.RawMessage(*row.WeatherSnapshot)
		}
		index[row.ID] = len(outfits)
		ids = append(ids, row.ID)
		outfits = append(outfits, Stored{Row: rowOf(row), Reasons: reasons, Weather: weather, Garments: []Garment{}})
	}
	if len(ids) == 0 {
		return outfits, nil
	}
	garments, err := q.GarmentsOfOutfits(ctx, store.GarmentsOfOutfitsParams{UserID: userID, OutfitIds: ids})
	if err != nil {
		return nil, fmt.Errorf("the items: %w", err)
	}
	var itemIDs []string
	for _, g := range garments {
		colors, err := texts(g.Colors)
		if err != nil {
			return nil, fmt.Errorf("item %s: the stored colours: %w", g.WardrobeItemId, err)
		}
		season, err := texts(g.Season)
		if err != nil {
			return nil, fmt.Errorf("item %s: the stored seasons: %w", g.WardrobeItemId, err)
		}
		at := index[g.OutfitId]
		outfits[at].Garments = append(outfits[at].Garments, Garment{
			Link:     Link{ID: g.ID, OutfitID: g.OutfitId, WardrobeItemID: g.WardrobeItemId, Role: g.Role},
			Category: g.Category, Subcategory: g.Subcategory, Colors: colors, Style: g.Style, Material: g.Material, Season: season,
			Images: []wardrobe.Image{},
		})
		if !slices.Contains(itemIDs, g.WardrobeItemId) {
			itemIDs = append(itemIDs, g.WardrobeItemId)
		}
	}
	if len(itemIDs) == 0 {
		return outfits, nil
	}
	images, err := q.WardrobeImagesOfItems(ctx, itemIDs)
	if err != nil {
		return nil, fmt.Errorf("the images: %w", err)
	}
	byItem := map[string][]wardrobe.Image{}
	for _, r := range images {
		byItem[r.WardrobeItemId] = append(byItem[r.WardrobeItemId], wardrobe.Image{
			ID: r.ID, StorageKey: r.StorageKey, DisplayKey: r.DisplayKey, ThumbnailKey: r.ThumbnailKey,
			IsPrimary: r.IsPrimary, Width: r.Width, Height: r.Height,
		})
	}
	for o := range outfits {
		for g := range outfits[o].Garments {
			if found := byItem[outfits[o].Garments[g].WardrobeItemID]; found != nil {
				outfits[o].Garments[g].Images = found
			}
		}
	}
	return outfits, nil
}

// Change is what a PATCH changes of an outfit: IsSaved when not nil, the
// name (to a text, or to none) when SetName.
type Change struct {
	IsSaved *bool
	SetName bool
	Name    *string
}

// Update changes an outfit of the user's; ErrNotFound otherwise.
func (s *Service) Update(ctx context.Context, userID, id string, change Change) (Row, error) {
	row, err := store.New(s.pool).UpdateOutfit(ctx, store.UpdateOutfitParams{
		ID: id, UserID: userID, IsSaved: change.IsSaved, SetName: change.SetName, Name: change.Name,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Row{}, ErrNotFound
	}
	if err != nil {
		return Row{}, fmt.Errorf("outfits: update %s: %w", id, err)
	}
	return rowOf(row), nil
}

// Delete removes an outfit of the user's with its items and feedback;
// ErrNotFound otherwise.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	n, err := store.New(s.pool).DeleteOutfit(ctx, store.DeleteOutfitParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("outfits: delete %s: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Feedback kinds that change whether the outfit is saved.
const (
	feedbackSaved    = "saved"
	feedbackRejected = "rejected"
)

// GivenFeedback is a stored feedback.
type GivenFeedback struct {
	ID        string
	UserID    string
	OutfitID  string
	Feedback  string
	Note      *string
	CreatedAt time.Time
}

// GiveFeedback records the user's feedback on an outfit of theirs
// (ErrNotFound otherwise). "saved" marks the outfit saved and "rejected"
// unmarks it, in the same transaction.
func (s *Service) GiveFeedback(ctx context.Context, userID, outfitID, kind string, note *string) (GivenFeedback, error) {
	var given GivenFeedback
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		outfit, err := q.LockOutfitOfUser(ctx, store.LockOutfitOfUserParams{ID: outfitID, UserId: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		row, err := q.InsertOutfitFeedback(ctx, store.InsertOutfitFeedbackParams{
			ID: platform.NewID(), UserID: userID, OutfitID: outfitID, Feedback: kind, Note: note,
		})
		if err != nil {
			return err
		}
		given = GivenFeedback{ID: row.ID, UserID: row.UserId, OutfitID: row.OutfitId, Feedback: row.Feedback, Note: row.Note, CreatedAt: row.CreatedAt}
		if (kind == feedbackSaved && !outfit.IsSaved) || (kind == feedbackRejected && outfit.IsSaved) {
			return q.SetOutfitSaved(ctx, store.SetOutfitSavedParams{ID: outfitID, UserID: userID, IsSaved: kind == feedbackSaved})
		}
		return nil
	})
	if err != nil {
		return GivenFeedback{}, fmt.Errorf("outfits: feedback on %s: %w", outfitID, err)
	}
	return given, nil
}
