package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"lookly/internal/apierr"
	"lookly/internal/engine"
	"lookly/internal/httpapi/contract"
	"lookly/internal/outfits"
	"lookly/internal/wardrobe"
)

// GenerateOutfits: outfits from the caller's wardrobe for the occasion and
// the weather. The gate's body rule has judged the body. Nothing is stored.
func (s *Server) GenerateOutfits(ctx context.Context, request contract.GenerateOutfitsRequestObject) (contract.GenerateOutfitsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Body == nil {
		return nil, errors.New("outfit generation: the gate's body rule left no body")
	}
	in := outfits.GenerateRequest{Seed: request.Body.Seed}
	if n := request.Body.TopN; n != nil {
		wanted := float64(*n)
		in.TopN = &wanted
	}
	if occasion, err := request.Body.Occasion.Get(); err == nil {
		name := string(occasion)
		in.Occasion = &name
	}
	if lat, err := request.Body.Lat.Get(); err == nil {
		in.Lat = &lat
	}
	if lon, err := request.Body.Lon.Get(); err == nil {
		in.Lon = &lon
	}
	if w, err := request.Body.Weather.Get(); err == nil {
		in.Weather = &engine.Weather{
			Temperature: &w.Temperature, FeelsLike: &w.FeelsLike, Condition: &w.Condition,
			PrecipitationProbability: &w.PrecipitationProbability, Humidity: &w.Humidity, WindSpeed: &w.WindSpeed, UVIndex: &w.UvIndex,
		}
	}
	generated, err := s.s.Outfits.Generate(ctx, id.UserID, in)
	if err != nil {
		return nil, outfitError(err)
	}

	body := generatedBody{
		Outfits: make([]generatedOutfitBody, 0, len(generated.Outfits)), Occasion: in.Occasion,
		WardrobeItemCount: generated.WardrobeItemCount, Fallback: generated.Fallback,
	}
	if w := generated.WeatherUsed; w != nil {
		body.WeatherUsed = &weatherUsedBody{
			Temperature: *w.Temperature, FeelsLike: *w.FeelsLike, Condition: *w.Condition,
			PrecipitationProbability: *w.PrecipitationProbability, Humidity: *w.Humidity, WindSpeed: *w.WindSpeed, UVIndex: *w.UVIndex,
		}
	}
	if generated.Message != "" {
		body.Message = &generated.Message
	}
	now := s.now()
	for _, outfit := range generated.Outfits {
		f := outfit.Factors
		made := generatedOutfitBody{
			TempID: outfit.TempID, Score: outfit.Score,
			Factors: factorsBody{
				Weather: f.Weather, Color: f.Color, Occasion: f.Occasion, Style: f.Style, Season: f.Season,
				Balance: f.Balance, Preference: f.Preference, Feedback: f.Feedback,
			},
			Reasons: outfit.Reasons, ReasonLabels: outfit.ReasonLabels, ContrastLevel: outfit.ContrastLevel,
			Items: make([]generatedItemBody, 0, len(outfit.Items)), Explanation: outfit.Explanation,
		}
		for i, piece := range outfit.Items {
			item := generatedItemBody{
				ID: piece.Item.ID, Role: piece.Role, LayeringRole: string(piece.Slot), Category: piece.Item.Category,
				Subcategory: piece.Item.Subcategory, Colors: piece.Item.Colors, Style: piece.Item.Style,
				Material: piece.Item.Material, Season: piece.Item.Season,
			}
			// The thumbnail, else the image itself; no image, no link.
			if image := outfit.Images[i]; image != nil {
				links := s.imageBody(*image, now)
				item.ImageURL = &links.URL
				if links.ThumbnailURL != nil {
					item.ImageURL = links.ThumbnailURL
				}
			}
			made.Items = append(made.Items, item)
		}
		body.Outfits = append(body.Outfits, made)
	}
	return generatedResponse{body}, nil
}

// generatedBody is the Next.js route's answer, member by member.
type generatedBody struct {
	Outfits           []generatedOutfitBody `json:"outfits"`
	WeatherUsed       *weatherUsedBody      `json:"weatherUsed"`
	Occasion          *string               `json:"occasion"`
	WardrobeItemCount int                   `json:"wardrobeItemCount"`
	Fallback          bool                  `json:"fallback"`
	// Message is there when there are no outfits: why.
	Message *string `json:"message,omitempty"`
}

type weatherUsedBody struct {
	Temperature              float64 `json:"temperature"`
	FeelsLike                float64 `json:"feelsLike"`
	Condition                string  `json:"condition"`
	PrecipitationProbability float64 `json:"precipitationProbability"`
	Humidity                 float64 `json:"humidity"`
	WindSpeed                float64 `json:"windSpeed"`
	UVIndex                  float64 `json:"uvIndex"`
}

type generatedOutfitBody struct {
	TempID        string              `json:"tempId"`
	Score         float64             `json:"score"`
	Factors       factorsBody         `json:"factors"`
	Reasons       []string            `json:"reasons"`
	ReasonLabels  []string            `json:"reasonLabels"`
	ContrastLevel string              `json:"contrastLevel"`
	Items         []generatedItemBody `json:"items"`
	Explanation   string              `json:"explanation"`
}

type factorsBody struct {
	Weather    float64 `json:"weather"`
	Color      float64 `json:"color"`
	Occasion   float64 `json:"occasion"`
	Style      float64 `json:"style"`
	Season     float64 `json:"season"`
	Balance    float64 `json:"balance"`
	Preference float64 `json:"preference"`
	Feedback   float64 `json:"feedback"`
}

type generatedItemBody struct {
	ID           string   `json:"id"`
	Role         string   `json:"role"`
	LayeringRole string   `json:"layeringRole"`
	Category     string   `json:"category"`
	Subcategory  *string  `json:"subcategory"`
	Colors       []string `json:"colors"`
	Style        *string  `json:"style"`
	Material     *string  `json:"material"`
	Season       []string `json:"season"`
	ImageURL     *string  `json:"imageUrl"`
}

type generatedResponse struct{ body generatedBody }

func (r generatedResponse) VisitGenerateOutfitsResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

// The Next.js routes' messages for an outfit that cannot be saved.
const (
	msgItemsNotOwned = "Ba'zi kiyimlar topilmadi yoki sizga tegishli emas"
	msgUnknownRole   = "Noma’lum rol: %s bo‘lishi kerak"
	msgWrongRole     = "Rol kiyim turiga mos emas (%s)"
)

// outfitError maps what the outfit service refuses to the contract's errors.
func outfitError(err error) error {
	var role *outfits.RoleError
	var composition *outfits.CompositionError
	var limited *outfits.LimitedError
	if errors.As(err, &limited) {
		return apierr.TooManyAttempts(limited.RetryAfter)
	}
	switch {
	case errors.Is(err, outfits.ErrNotFound):
		return apierr.New(apierr.NotFound)
	case errors.Is(err, outfits.ErrNotOwned):
		return apierr.With(apierr.Forbidden, msgItemsNotOwned)
	case errors.As(err, &role):
		message := fmt.Sprintf(msgWrongRole, strings.Join(role.Allowed, " / "))
		if role.Unknown {
			message = fmt.Sprintf(msgUnknownRole, strings.Join(role.Allowed, ", "))
		}
		return apierr.Validation(message, apierr.Detail{Path: "items." + strconv.Itoa(role.Index) + ".role", Message: message})
	case errors.As(err, &composition):
		message := composition.Problem.Message()
		return apierr.Validation(message, apierr.Detail{Path: "items", Message: message})
	}
	return err
}

// SaveOutfit: stores an outfit of the caller's items.
func (s *Server) SaveOutfit(ctx context.Context, request contract.SaveOutfitRequestObject) (contract.SaveOutfitResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Body == nil {
		return nil, errors.New("outfit save: the gate's body rule left no body")
	}
	body := request.Body
	in := outfits.SaveRequest{Items: make([]outfits.SaveItem, 0, len(body.Items)), IsSaved: body.IsSaved != nil && *body.IsSaved}
	for _, item := range body.Items {
		in.Items = append(in.Items, outfits.SaveItem{ItemID: item.ItemId, Role: item.Role})
	}
	if occasion, err := body.Occasion.Get(); err == nil {
		name := string(occasion)
		in.Occasion = &name
	}
	if w, err := body.Weather.Get(); err == nil {
		in.Weather = &outfits.WeatherSnapshot{
			Temperature: w.Temperature, FeelsLike: w.FeelsLike, Condition: w.Condition,
			PrecipitationProbability: w.PrecipitationProbability, Humidity: w.Humidity, WindSpeed: w.WindSpeed, UVIndex: w.UvIndex,
		}
	}
	if name, err := body.Name.Get(); err == nil {
		in.Name = &name
	}
	if score, err := body.Score.Get(); err == nil {
		in.Score = &score
	}
	if body.Reasons != nil {
		in.Reasons = *body.Reasons
	}
	if explanation, err := body.Explanation.Get(); err == nil {
		in.Explanation = &explanation
	}
	saved, err := s.s.Outfits.Save(ctx, id.UserID, in)
	if err != nil {
		return nil, outfitError(err)
	}
	answer := savedOutfitBody{outfitRowBody: rowBody(saved.Row), Items: make([]outfitLinkBody, 0, len(saved.Items))}
	for _, link := range saved.Items {
		answer.Items = append(answer.Items, outfitLinkBody{
			ID: link.ID, OutfitID: link.OutfitID, WardrobeItemID: link.WardrobeItemID, Role: link.Role, CreatedAt: isoMillis(link.CreatedAt),
		})
	}
	return outfitResponse{http.StatusCreated, map[string]any{"outfit": answer}}, nil
}

// ListOutfits: the caller's newest outfits, all or the saved ones.
func (s *Server) ListOutfits(ctx context.Context, request contract.ListOutfitsRequestObject) (contract.ListOutfitsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	saved := request.Params.Saved
	stored, err := s.s.Outfits.List(ctx, id.UserID, saved != nil && (*saved == "1" || *saved == "true"))
	if err != nil {
		return nil, err
	}
	now := s.now()
	list := make([]outfitSummaryBody, 0, len(stored))
	for _, outfit := range stored {
		summary := outfitSummaryBody{
			ID: outfit.ID, Name: outfit.Name, Occasion: outfit.Occasion, Score: outfit.Score, Reasons: outfit.Reasons,
			Explanation: outfit.Explanation, IsSaved: outfit.IsSaved, WeatherSnapshot: outfit.Weather,
			CreatedAt: isoMillis(outfit.CreatedAt), Items: make([]outfitSummaryItemBody, 0, len(outfit.Garments)),
		}
		for _, g := range outfit.Garments {
			item := outfitSummaryItemBody{
				ID: g.WardrobeItemID, Role: g.Role, Category: g.Category, Subcategory: g.Subcategory, Colors: g.Colors,
				Style: g.Style, Material: g.Material, Season: g.Season,
			}
			if primary := wardrobe.Primary(g.Images); primary >= 0 {
				image := s.imageBody(g.Images[primary], now)
				item.Image = &image
			}
			summary.Items = append(summary.Items, item)
		}
		list = append(list, summary)
	}
	return outfitResponse{http.StatusOK, map[string]any{"outfits": list}}, nil
}

// GetOutfit: one outfit of the caller's with its items.
func (s *Server) GetOutfit(ctx context.Context, request contract.GetOutfitRequestObject) (contract.GetOutfitResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	outfit, err := s.s.Outfits.Get(ctx, id.UserID, itemID(request.Id))
	if err != nil {
		return nil, outfitError(err)
	}
	now := s.now()
	row := rowBody(outfit.Row)
	detail := outfitDetailBody{
		ID: row.ID, UserID: row.UserID, Name: row.Name, Occasion: row.Occasion, WeatherSnapshot: outfit.Weather, Score: row.Score,
		ReasonsJSON: row.ReasonsJSON, Explanation: row.Explanation, IsSaved: row.IsSaved, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		Reasons: outfit.Reasons, Items: make([]outfitDetailItemBody, 0, len(outfit.Garments)),
	}
	for _, g := range outfit.Garments {
		item := outfitDetailItemBody{ID: g.ID, Role: g.Role, WardrobeItemID: g.WardrobeItemID}
		item.Item = outfitGarmentBody{
			ID: g.WardrobeItemID, Category: g.Category, Subcategory: g.Subcategory, Colors: g.Colors, Style: g.Style,
			Material: g.Material, Season: g.Season, Images: make([]imageBody, 0, len(g.Images)),
		}
		for _, img := range g.Images {
			item.Item.Images = append(item.Item.Images, s.imageBody(img, now))
		}
		detail.Items = append(detail.Items, item)
	}
	return outfitResponse{http.StatusOK, map[string]any{"outfit": detail}}, nil
}

// UpdateOutfit: marks an outfit of the caller's saved or not, or names it.
func (s *Server) UpdateOutfit(ctx context.Context, request contract.UpdateOutfitRequestObject) (contract.UpdateOutfitResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Body == nil {
		return nil, errors.New("outfit update: the gate's body rule left no body")
	}
	change := outfits.Change{IsSaved: request.Body.IsSaved, SetName: request.Body.Name.IsSpecified()}
	if name, err := request.Body.Name.Get(); err == nil {
		change.Name = &name
	}
	row, err := s.s.Outfits.Update(ctx, id.UserID, itemID(request.Id), change)
	if err != nil {
		return nil, outfitError(err)
	}
	return outfitResponse{http.StatusOK, map[string]any{"outfit": rowBody(row)}}, nil
}

// DeleteOutfit: removes an outfit of the caller's.
func (s *Server) DeleteOutfit(ctx context.Context, request contract.DeleteOutfitRequestObject) (contract.DeleteOutfitResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err := s.s.Outfits.Delete(ctx, id.UserID, itemID(request.Id)); err != nil {
		return nil, outfitError(err)
	}
	return outfitResponse{http.StatusOK, map[string]any{"ok": true}}, nil
}

// SendOutfitFeedback: the caller's feedback on an outfit of theirs.
func (s *Server) SendOutfitFeedback(ctx context.Context, request contract.SendOutfitFeedbackRequestObject) (contract.SendOutfitFeedbackResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Body == nil {
		return nil, errors.New("outfit feedback: the gate's body rule left no body")
	}
	given, err := s.s.Outfits.GiveFeedback(ctx, id.UserID, itemID(request.Id), string(request.Body.Feedback), request.Body.Note)
	if err != nil {
		return nil, outfitError(err)
	}
	return outfitResponse{http.StatusCreated, map[string]any{"feedback": feedbackBody{
		ID: given.ID, UserID: given.UserID, OutfitID: given.OutfitID, Feedback: given.Feedback, Note: given.Note, CreatedAt: isoMillis(given.CreatedAt),
	}}}, nil
}

// outfitRowBody is a stored outfit as the Next.js routes answered it after
// a write: the database row, member by member. The contract lists some of
// these members (OutfitRow) and allows the rest; the web tests read
// reasonsJson. Cutting the answer down to the contract is a contract change
// for a later stage.
type outfitRowBody struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId"`
	Name            *string `json:"name"`
	Occasion        *string `json:"occasion"`
	WeatherSnapshot *string `json:"weatherSnapshot"` // the stored text
	Score           *int32  `json:"score"`
	ReasonsJSON     string  `json:"reasonsJson"`
	Explanation     *string `json:"explanation"`
	IsSaved         bool    `json:"isSaved"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

func rowBody(row outfits.Row) outfitRowBody {
	return outfitRowBody{
		ID: row.ID, UserID: row.UserID, Name: row.Name, Occasion: row.Occasion, WeatherSnapshot: row.WeatherSnapshot, Score: row.Score,
		ReasonsJSON: row.ReasonsJSON, Explanation: row.Explanation, IsSaved: row.IsSaved,
		CreatedAt: isoMillis(row.CreatedAt), UpdatedAt: isoMillis(row.UpdatedAt),
	}
}

// outfitLinkBody is an outfit's item row.
type outfitLinkBody struct {
	ID             string  `json:"id"`
	OutfitID       string  `json:"outfitId"`
	WardrobeItemID string  `json:"wardrobeItemId"`
	Role           *string `json:"role"`
	CreatedAt      string  `json:"createdAt"`
}

type savedOutfitBody struct {
	outfitRowBody
	Items []outfitLinkBody `json:"items"`
}

type outfitSummaryBody struct {
	ID              string                  `json:"id"`
	Name            *string                 `json:"name"`
	Occasion        *string                 `json:"occasion"`
	Score           *int32                  `json:"score"`
	Reasons         []string                `json:"reasons"`
	Explanation     *string                 `json:"explanation"`
	IsSaved         bool                    `json:"isSaved"`
	WeatherSnapshot json.RawMessage         `json:"weatherSnapshot"`
	CreatedAt       string                  `json:"createdAt"`
	Items           []outfitSummaryItemBody `json:"items"`
}

type outfitSummaryItemBody struct {
	ID          string     `json:"id"`
	Role        *string    `json:"role"`
	Category    string     `json:"category"`
	Subcategory *string    `json:"subcategory"`
	Colors      []string   `json:"colors"`
	Style       *string    `json:"style"`
	Material    *string    `json:"material"`
	Season      []string   `json:"season"`
	Image       *imageBody `json:"image"`
}

// outfitDetailBody is the outfit's row with the weather decoded, the
// reasons decoded beside their stored text, and the items.
type outfitDetailBody struct {
	ID              string                 `json:"id"`
	UserID          string                 `json:"userId"`
	Name            *string                `json:"name"`
	Occasion        *string                `json:"occasion"`
	WeatherSnapshot json.RawMessage        `json:"weatherSnapshot"`
	Score           *int32                 `json:"score"`
	ReasonsJSON     string                 `json:"reasonsJson"`
	Explanation     *string                `json:"explanation"`
	IsSaved         bool                   `json:"isSaved"`
	CreatedAt       string                 `json:"createdAt"`
	UpdatedAt       string                 `json:"updatedAt"`
	Reasons         []string               `json:"reasons"`
	Items           []outfitDetailItemBody `json:"items"`
}

type outfitDetailItemBody struct {
	ID             string            `json:"id"`
	Role           *string           `json:"role"`
	WardrobeItemID string            `json:"wardrobeItemId"`
	Item           outfitGarmentBody `json:"item"`
}

type outfitGarmentBody struct {
	ID          string      `json:"id"`
	Category    string      `json:"category"`
	Subcategory *string     `json:"subcategory"`
	Colors      []string    `json:"colors"`
	Style       *string     `json:"style"`
	Material    *string     `json:"material"`
	Season      []string    `json:"season"`
	Images      []imageBody `json:"images"`
}

// feedbackBody is the feedback's row.
type feedbackBody struct {
	ID        string  `json:"id"`
	UserID    string  `json:"userId"`
	OutfitID  string  `json:"outfitId"`
	Feedback  string  `json:"feedback"`
	Note      *string `json:"note"`
	CreatedAt string  `json:"createdAt"`
}

// outfitResponse answers the outfit routes: a status and a body.
type outfitResponse struct {
	status int
	body   any
}

func (r outfitResponse) write(w http.ResponseWriter) error { return writeJSON(w, r.status, r.body) }

func (r outfitResponse) VisitSaveOutfitResponse(w http.ResponseWriter) error   { return r.write(w) }
func (r outfitResponse) VisitListOutfitsResponse(w http.ResponseWriter) error  { return r.write(w) }
func (r outfitResponse) VisitGetOutfitResponse(w http.ResponseWriter) error    { return r.write(w) }
func (r outfitResponse) VisitUpdateOutfitResponse(w http.ResponseWriter) error { return r.write(w) }
func (r outfitResponse) VisitDeleteOutfitResponse(w http.ResponseWriter) error { return r.write(w) }
func (r outfitResponse) VisitSendOutfitFeedbackResponse(w http.ResponseWriter) error {
	return r.write(w)
}
