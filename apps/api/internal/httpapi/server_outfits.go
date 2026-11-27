package httpapi

import (
	"context"
	"errors"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/engine"
	"lookly/internal/httpapi/contract"
	"lookly/internal/outfits"
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
		return nil, err
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
