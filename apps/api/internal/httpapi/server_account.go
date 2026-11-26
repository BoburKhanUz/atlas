package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/oapi-codegen/nullable"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/legal"
	"lookly/internal/profile"
)

// The account operations of stage B3 (docs/plan/B3.md): the legal texts and
// the renewed consent, the profile, the password reset, the deletion of the
// account.

// GetLegalDocuments is the current privacy policy and terms of use. Public.
func (s *Server) GetLegalDocuments(context.Context, contract.GetLegalDocumentsRequestObject) (contract.GetLegalDocumentsResponseObject, error) {
	return legalDocuments{}, nil
}

// legalDocuments writes the embedded texts as they are: they are the
// contract's LegalResponse already (a test holds them to it).
type legalDocuments struct{}

func (legalDocuments) VisitGetLegalDocumentsResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(legal.Documents())
	return err
}

// AcceptLegalDocuments records the signed-in user's consent to the current
// texts (the gate's body rule refuses any other version). Served although
// the consent is out of date: that is what it is for.
func (s *Server) AcceptLegalDocuments(ctx context.Context, request contract.AcceptLegalDocumentsRequestObject) (contract.AcceptLegalDocumentsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	err := s.s.Legal.Accept(ctx, id.UserID, request.Body.AcceptedLegalVersion, request.Body.AgeConfirmed)
	if errors.Is(err, legal.ErrNoUser) {
		// The account was deleted after the gate let the request in.
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err != nil {
		return nil, err
	}
	return contract.AcceptLegalDocuments200JSONResponse{Ok: true}, nil
}

// GetProfile is the signed-in user's profile and style preferences.
func (s *Server) GetProfile(ctx context.Context, _ contract.GetProfileRequestObject) (contract.GetProfileResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	view, err := s.s.Profile.Get(ctx, id.UserID)
	if errors.Is(err, profile.ErrNoUser) {
		// The account was deleted after the gate let the request in.
		return nil, apierr.New(apierr.NotFound)
	}
	if err != nil {
		return nil, err
	}
	body := profileBody{Profile: profileRow(view.Profile)}
	body.User.ID, body.User.Email, body.User.Name = view.User.ID, view.User.Email, view.User.Name
	body.User.CreatedAt = isoMillis(view.User.CreatedAt)
	body.User.Profile, body.User.Preferences = profileRow(view.Profile), preferencesRow(view.Preferences)
	if p := view.Preferences; p != nil {
		lists, err := profile.ListsOf(*p)
		if err != nil {
			return nil, err
		}
		body.Preferences = &preferencesBody{
			ID: p.ID, UserID: p.UserId,
			PreferredStyles: lists.PreferredStyles, DislikedStyles: lists.DislikedStyles,
			FavoriteColors: lists.FavoriteColors, DislikedColors: lists.DislikedColors,
			Language: p.Language, CreatedAt: isoMillis(p.CreatedAt), UpdatedAt: isoMillis(p.UpdatedAt),
		}
	}
	return profileResponse{body}, nil
}

// UpdateProfile changes the name, profile fields and preferences that the
// request names (the gate's body rule validated and normalised them), all
// or none, and answers with the user after the change.
func (s *Server) UpdateProfile(ctx context.Context, request contract.UpdateProfileRequestObject) (contract.UpdateProfileResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	change := profile.Change{Name: request.Body.Name}
	if p := request.Body.Profile; p != nil {
		change.Profile = &profile.ProfileChange{
			Gender: textField(p.Gender), AgeRange: textField(p.AgeRange),
			Height: field(p.Height, same[float64]), Weight: field(p.Weight, same[float64]),
			BodyShape: textField(p.BodyShape), SkinTone: textField(p.SkinTone), SkinUndertone: textField(p.SkinUndertone),
			HairColor: textField(p.HairColor), EyeColor: textField(p.EyeColor), ClothingSize: textField(p.ClothingSize),
			PreferredFit: textField(p.PreferredFit),
			// The body rule holds the budget to 0..1e9: it fits.
			TypicalBudget: field(p.TypicalBudget, func(v int) int32 { return int32(v) }),
		}
	}
	if p := request.Body.Preferences; p != nil {
		change.Preferences = &profile.PreferencesChange{
			PreferredStyles: texts(p.PreferredStyles), DislikedStyles: texts(p.DislikedStyles),
			FavoriteColors: texts(p.FavoriteColors), DislikedColors: texts(p.DislikedColors),
		}
		if p.Language != nil {
			language := string(*p.Language)
			change.Preferences.Language = &language
		}
	}
	view, err := s.s.Profile.Update(ctx, id.UserID, change)
	if errors.Is(err, profile.ErrNoUser) {
		// The account was deleted after the gate let the request in.
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err != nil {
		return nil, err
	}
	var body profilePatchBody
	body.User.ID, body.User.Email, body.User.Name = view.User.ID, view.User.Email, view.User.Name
	body.User.Profile, body.User.Preferences = profileRow(view.Profile), preferencesRow(view.Preferences)
	return profilePatchResponse{body}, nil
}

// field reads one member of the profile section: named or not, and null or
// a value (converted with to).
func field[In, Out any](n nullable.Nullable[In], to func(In) Out) profile.Field[Out] {
	if !n.IsSpecified() {
		return profile.Field[Out]{}
	}
	f := profile.Field[Out]{Set: true}
	if value, err := n.Get(); err == nil { // an error means null
		out := to(value)
		f.Value = &out
	}
	return f
}

func same[T any](v T) T { return v }

func textField[T ~string](n nullable.Nullable[T]) profile.Field[string] {
	return field(n, func(v T) string { return string(v) })
}

// texts turns a list of one of the contract's enumerations into strings.
func texts[T ~string](in *[]T) *[]string {
	if in == nil {
		return nil
	}
	out := make([]string, 0, len(*in))
	for _, v := range *in {
		out = append(out, string(v))
	}
	return &out
}

// ─── Profile responses ───────────────────────────────────────────────────
//
// The two shapes the Next.js API has (clients read both): the rows as they
// are stored, with times in milliseconds, and for the read also the
// preferences with their lists as lists.

type profileRowBody struct {
	ID             string   `json:"id"`
	UserID         string   `json:"userId"`
	Gender         *string  `json:"gender"`
	AgeRange       *string  `json:"ageRange"`
	Height         *float64 `json:"height"`
	Weight         *float64 `json:"weight"`
	BodyShape      *string  `json:"bodyShape"`
	SkinTone       *string  `json:"skinTone"`
	SkinUndertone  *string  `json:"skinUndertone"`
	HairColor      *string  `json:"hairColor"`
	EyeColor       *string  `json:"eyeColor"`
	ClothingSize   *string  `json:"clothingSize"`
	PreferredFit   *string  `json:"preferredFit"`
	TypicalBudget  *int32   `json:"typicalBudget"`
	ColorProfileID *string  `json:"colorProfileId"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

func profileRow(r *profile.Row) *profileRowBody {
	if r == nil {
		return nil
	}
	return &profileRowBody{
		ID: r.ID, UserID: r.UserId, Gender: r.Gender, AgeRange: r.AgeRange, Height: r.Height, Weight: r.Weight,
		BodyShape: r.BodyShape, SkinTone: r.SkinTone, SkinUndertone: r.SkinUndertone, HairColor: r.HairColor, EyeColor: r.EyeColor,
		ClothingSize: r.ClothingSize, PreferredFit: r.PreferredFit, TypicalBudget: r.TypicalBudget, ColorProfileID: r.ColorProfileId,
		CreatedAt: isoMillis(r.CreatedAt), UpdatedAt: isoMillis(r.UpdatedAt),
	}
}

// preferencesRowBody is the stored row: its lists are JSON text.
type preferencesRowBody struct {
	ID              string `json:"id"`
	UserID          string `json:"userId"`
	PreferredStyles string `json:"preferredStyles"`
	DislikedStyles  string `json:"dislikedStyles"`
	FavoriteColors  string `json:"favoriteColors"`
	DislikedColors  string `json:"dislikedColors"`
	Language        string `json:"language"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

func preferencesRow(r *profile.PreferencesRow) *preferencesRowBody {
	if r == nil {
		return nil
	}
	return &preferencesRowBody{
		ID: r.ID, UserID: r.UserId, PreferredStyles: r.PreferredStyles, DislikedStyles: r.DislikedStyles,
		FavoriteColors: r.FavoriteColors, DislikedColors: r.DislikedColors, Language: r.Language,
		CreatedAt: isoMillis(r.CreatedAt), UpdatedAt: isoMillis(r.UpdatedAt),
	}
}

// preferencesBody is the row with its lists read.
type preferencesBody struct {
	ID              string   `json:"id"`
	UserID          string   `json:"userId"`
	PreferredStyles []string `json:"preferredStyles"`
	DislikedStyles  []string `json:"dislikedStyles"`
	FavoriteColors  []string `json:"favoriteColors"`
	DislikedColors  []string `json:"dislikedColors"`
	Language        string   `json:"language"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type profileBody struct {
	User struct {
		ID          string              `json:"id"`
		Email       string              `json:"email"`
		Name        *string             `json:"name"`
		CreatedAt   string              `json:"createdAt"`
		Profile     *profileRowBody     `json:"profile"`
		Preferences *preferencesRowBody `json:"preferences"`
	} `json:"user"`
	Profile     *profileRowBody  `json:"profile"`
	Preferences *preferencesBody `json:"preferences"`
}

type profilePatchBody struct {
	User struct {
		ID          string              `json:"id"`
		Email       string              `json:"email"`
		Name        *string             `json:"name"`
		Profile     *profileRowBody     `json:"profile"`
		Preferences *preferencesRowBody `json:"preferences"`
	} `json:"user"`
}

type profileResponse struct{ body profileBody }

func (r profileResponse) VisitGetProfileResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

type profilePatchResponse struct{ body profilePatchBody }

func (r profilePatchResponse) VisitUpdateProfileResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}
