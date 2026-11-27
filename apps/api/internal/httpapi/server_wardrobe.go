package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/oapi-codegen/nullable"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/wardrobe"
)

// msgSubcategoryMismatch is the Next.js route's message.
const msgSubcategoryMismatch = "Bu tur tanlangan toifaga mos emas"

// ListWardrobeItems: a page of the caller's items, newest first. The gate's
// query rule has judged the query and filled in the limit.
func (s *Server) ListWardrobeItems(ctx context.Context, request contract.ListWardrobeItemsRequestObject) (contract.ListWardrobeItemsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Params.Limit == nil {
		return nil, errors.New("wardrobe list: the gate's query rule did not fill in the limit")
	}
	var category *string
	if c := request.Params.Category; c != nil && *c != "all" {
		name := string(*c)
		category = &name
	}
	page, err := s.s.Wardrobe.List(ctx, id.UserID, category, *request.Params.Limit, request.Params.Cursor)
	if err != nil {
		return nil, err
	}
	body := wardrobeListBody{Items: make([]wardrobeItemBody, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, item := range page.Items {
		body.Items = append(body.Items, s.itemBody(item))
	}
	return wardrobeListResponse{body}, nil
}

// GetWardrobeItem: one item of the caller's.
func (s *Server) GetWardrobeItem(ctx context.Context, request contract.GetWardrobeItemRequestObject) (contract.GetWardrobeItemResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	item, err := s.s.Wardrobe.Get(ctx, id.UserID, itemID(request.Id))
	if err != nil {
		return nil, wardrobeError(err)
	}
	return wardrobeItemResponse{wardrobeItemOnly{s.itemBody(item)}}, nil
}

// UpdateWardrobeItem: the caller's corrections of an item's attributes.
func (s *Server) UpdateWardrobeItem(ctx context.Context, request contract.UpdateWardrobeItemRequestObject) (contract.UpdateWardrobeItemResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	b := request.Body
	patch := wardrobe.Patch{
		Subcategory: itemField(b.Subcategory), Pattern: itemField(b.Pattern), Material: itemField(b.Material),
		SleeveLength: itemField(b.SleeveLength), Fit: itemField(b.Fit), Style: itemField(b.Style),
		Gender: itemField(b.Gender), Formality: itemField(b.Formality),
		Colors: texts(b.Colors), Season: texts(b.Season),
	}
	if b.Category != nil {
		category := string(*b.Category)
		patch.Category = &category
	}
	item, made, err := s.s.Wardrobe.Correct(ctx, id.UserID, itemID(request.Id), patch)
	if err != nil {
		return nil, wardrobeError(err)
	}
	if made == nil {
		made = []wardrobe.Correction{}
	}
	return wardrobePatchResponse{wardrobePatchBody{Item: s.itemBody(item), Corrections: made}}, nil
}

// DeleteWardrobeItem: an item of the caller's, with its images.
func (s *Server) DeleteWardrobeItem(ctx context.Context, request contract.DeleteWardrobeItemRequestObject) (contract.DeleteWardrobeItemResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err := s.s.Wardrobe.Delete(ctx, id.UserID, itemID(request.Id)); err != nil {
		return nil, wardrobeError(err)
	}
	return contract.DeleteWardrobeItem200JSONResponse{Ok: true}, nil
}

// itemID is the id as the gate accepted it: trimmed, as the Next.js routes
// look it up.
func itemID(raw string) string {
	id, _ := ItemID(raw)
	return id
}

func wardrobeError(err error) error {
	switch {
	case errors.Is(err, wardrobe.ErrNotFound):
		return apierr.New(apierr.NotFound)
	case errors.Is(err, wardrobe.ErrSubcategoryMismatch):
		return apierr.Validation(msgSubcategoryMismatch, apierr.Detail{Path: "subcategory", Message: msgSubcategoryMismatch})
	}
	return err
}

func itemField[T ~string](n nullable.Nullable[T]) wardrobe.Field {
	f := textField(n)
	return wardrobe.Field{Set: f.Set, Value: f.Value}
}

// wardrobeItemBody is an item as every wardrobe route answers it: the
// Next.js serializer's shape (apps/web/src/lib/wardrobe/serialize.ts), with
// the images as signed links.
type wardrobeItemBody struct {
	ID            string                `json:"id"`
	Category      string                `json:"category"`
	Subcategory   *string               `json:"subcategory"`
	Colors        []string              `json:"colors"`
	Pattern       *string               `json:"pattern"`
	Material      *string               `json:"material"`
	SleeveLength  *string               `json:"sleeveLength"`
	Fit           *string               `json:"fit"`
	Style         *string               `json:"style"`
	Season        []string              `json:"season"`
	Gender        *string               `json:"gender"`
	Formality     *string               `json:"formality"`
	Confidences   map[string]float64    `json:"confidences"`
	WasCorrected  bool                  `json:"wasCorrected"`
	CorrectionLog []wardrobe.Correction `json:"correctionLog"`
	Images        []imageBody           `json:"images"`
	PrimaryImage  *imageBody            `json:"primaryImage"`
	CreatedAt     string                `json:"createdAt"`
	UpdatedAt     string                `json:"updatedAt"`
}

// imageBody is an image as clients see it: links that expire, never a
// storage key.
type imageBody struct {
	ID           string  `json:"id"`
	URL          string  `json:"url"`
	ThumbnailURL *string `json:"thumbnailUrl"`
	URLExpiresAt string  `json:"urlExpiresAt"`
	IsPrimary    bool    `json:"isPrimary"`
	Width        *int32  `json:"width"`
	Height       *int32  `json:"height"`
}

func (s *Server) itemBody(item wardrobe.Item) wardrobeItemBody {
	body := wardrobeItemBody{
		ID: item.ID, Category: item.Category, Subcategory: item.Subcategory, Colors: item.Colors,
		Pattern: item.Pattern, Material: item.Material, SleeveLength: item.SleeveLength, Fit: item.Fit, Style: item.Style,
		Season: item.Season, Gender: item.Gender, Formality: item.Formality, Confidences: item.Confidences,
		WasCorrected: item.WasCorrected, CorrectionLog: item.CorrectionLog,
		Images:    make([]imageBody, 0, len(item.Images)),
		CreatedAt: isoMillis(item.CreatedAt), UpdatedAt: isoMillis(item.UpdatedAt),
	}
	now := s.now()
	for _, img := range item.Images {
		body.Images = append(body.Images, s.imageBody(img, now))
	}
	if primary := wardrobe.Primary(item.Images); primary >= 0 {
		body.PrimaryImage = &body.Images[primary]
	}
	return body
}

// imageBody signs the display variant (the master for an image from before
// the variants) and the thumbnail, when there is one.
func (s *Server) imageBody(img wardrobe.Image, now time.Time) imageBody {
	main := img.StorageKey
	if img.DisplayKey != nil {
		main = *img.DisplayKey
	}
	url, expiresAt := s.s.Media.Sign(main, now)
	body := imageBody{ID: img.ID, URL: url, URLExpiresAt: isoMillis(expiresAt), IsPrimary: img.IsPrimary, Width: img.Width, Height: img.Height}
	if img.ThumbnailKey != nil && *img.ThumbnailKey != "" {
		thumbnail, _ := s.s.Media.Sign(*img.ThumbnailKey, now)
		body.ThumbnailURL = &thumbnail
	}
	return body
}

type wardrobeListBody struct {
	Items      []wardrobeItemBody `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

type wardrobeListResponse struct{ body wardrobeListBody }

func (r wardrobeListResponse) VisitListWardrobeItemsResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

type wardrobeItemOnly struct {
	Item wardrobeItemBody `json:"item"`
}

type wardrobeItemResponse struct{ body wardrobeItemOnly }

func (r wardrobeItemResponse) VisitGetWardrobeItemResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

type wardrobePatchBody struct {
	Item        wardrobeItemBody      `json:"item"`
	Corrections []wardrobe.Correction `json:"corrections"`
}

type wardrobePatchResponse struct{ body wardrobePatchBody }

func (r wardrobePatchResponse) VisitUpdateWardrobeItemResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}
