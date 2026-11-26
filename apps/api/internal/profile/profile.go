// Package profile is the user's profile and style preferences: reading them
// and changing them.
package profile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/platform"
	"lookly/internal/store"
)

// ErrNoUser: the account does not exist (any more).
var ErrNoUser = errors.New("profile: no such user")

// User is the account a profile belongs to.
type User struct {
	ID        string
	Email     string
	Name      *string
	CreatedAt time.Time
}

// Row is a user's profile as stored. PreferencesRow is a user's preferences
// as stored: until the cutover (B7) its lists are JSON text.
type (
	Row            = store.UserProfile
	PreferencesRow = store.UserPreferences
)

// View is a user with the two rows; a user from before registration made
// them may have neither.
type View struct {
	User        User
	Profile     *Row
	Preferences *PreferencesRow
}

// Lists are the style and colour lists of a preferences row.
type Lists struct {
	PreferredStyles, DislikedStyles, FavoriteColors, DislikedColors []string
}

// ListsOf reads the row's lists. Only this server and the Next.js API write
// them, from validated values: text that is not a JSON list of strings is
// an error, not an empty list.
func ListsOf(p PreferencesRow) (Lists, error) {
	var l Lists
	for _, column := range []struct {
		name string
		text string
		into *[]string
	}{
		{"preferredStyles", p.PreferredStyles, &l.PreferredStyles},
		{"dislikedStyles", p.DislikedStyles, &l.DislikedStyles},
		{"favoriteColors", p.FavoriteColors, &l.FavoriteColors},
		{"dislikedColors", p.DislikedColors, &l.DislikedColors},
	} {
		if err := json.Unmarshal([]byte(column.text), column.into); err != nil || *column.into == nil {
			return Lists{}, fmt.Errorf("the stored %s of user %s is not a JSON list of strings", column.name, p.UserId)
		}
	}
	return l, nil
}

// Field is a change of one profile field that can be empty: Set says the
// request named it; a nil Value clears it.
type Field[T any] struct {
	Set   bool
	Value *T
}

// ProfileChange is the profile section of a change.
type ProfileChange struct {
	Gender, AgeRange                                                                    Field[string]
	Height, Weight                                                                      Field[float64]
	BodyShape, SkinTone, SkinUndertone, HairColor, EyeColor, ClothingSize, PreferredFit Field[string]
	TypicalBudget                                                                       Field[int32]
}

// PreferencesChange is the preferences section of a change; nil leaves a
// field as it is.
type PreferencesChange struct {
	PreferredStyles, DislikedStyles, FavoriteColors, DislikedColors *[]string
	Language                                                        *string
}

// Change is what a request changes: nil leaves the name or a whole section
// as it is. The values are valid already (the HTTP edge's body rule).
type Change struct {
	Name        *string
	Profile     *ProfileChange
	Preferences *PreferencesChange
}

// Service is the profile use cases.
type Service struct{ pool *pgxpool.Pool }

// New returns a Service over the pool.
func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Get returns the user's profile. ErrNoUser when the account is gone.
func (s *Service) Get(ctx context.Context, userID string) (View, error) {
	return load(ctx, store.New(s.pool), userID)
}

// Update applies a change in one transaction, all of it or none, and
// returns the profile after it. A section that is present moves its row's
// updatedAt and creates the row when the user has none. ErrNoUser when the
// account is gone.
func (s *Service) Update(ctx context.Context, userID string, c Change) (View, error) {
	var view View
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		// The account's changes go one at a time, and not while it is
		// being deleted.
		if _, err := q.LockUser(ctx, userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNoUser
			}
			return fmt.Errorf("lock the user: %w", err)
		}
		if c.Name != nil {
			// Nothing storable left: the name stays.
			if name := platform.StripNUL(*c.Name); name != "" {
				if err := q.SetUserName(ctx, store.SetUserNameParams{ID: userID, Name: &name}); err != nil {
					return fmt.Errorf("set the name: %w", err)
				}
			}
		}
		if c.Profile != nil {
			if err := q.UpsertUserProfile(ctx, profileParams(userID, *c.Profile)); err != nil {
				return fmt.Errorf("write the profile: %w", err)
			}
		}
		if c.Preferences != nil {
			params, err := preferencesParams(userID, *c.Preferences)
			if err != nil {
				return err
			}
			if err := q.UpsertUserPreferences(ctx, params); err != nil {
				return fmt.Errorf("write the preferences: %w", err)
			}
		}
		var err error
		view, err = load(ctx, q, userID)
		return err
	})
	return view, err
}

func load(ctx context.Context, q *store.Queries, userID string) (View, error) {
	user, err := q.UserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNoUser
	} else if err != nil {
		return View{}, fmt.Errorf("load the user: %w", err)
	}
	view := View{User: User{ID: user.ID, Email: user.Email, Name: user.Name, CreatedAt: user.CreatedAt}}
	switch row, err := q.UserProfileByUser(ctx, userID); {
	case err == nil:
		view.Profile = &row
	case !errors.Is(err, pgx.ErrNoRows):
		return View{}, fmt.Errorf("load the profile: %w", err)
	}
	switch row, err := q.UserPreferencesByUser(ctx, userID); {
	case err == nil:
		view.Preferences = &row
	case !errors.Is(err, pgx.ErrNoRows):
		return View{}, fmt.Errorf("load the preferences: %w", err)
	}
	return view, nil
}

// text is a field's value as it can be stored.
func text(f Field[string]) *string {
	if f.Value == nil {
		return nil
	}
	cleaned := platform.StripNUL(*f.Value)
	return &cleaned
}

func profileParams(userID string, c ProfileChange) store.UpsertUserProfileParams {
	return store.UpsertUserProfileParams{
		ID: platform.NewID(), UserID: userID,
		Gender: text(c.Gender), SetGender: c.Gender.Set,
		AgeRange: text(c.AgeRange), SetAgeRange: c.AgeRange.Set,
		Height: c.Height.Value, SetHeight: c.Height.Set,
		Weight: c.Weight.Value, SetWeight: c.Weight.Set,
		BodyShape: text(c.BodyShape), SetBodyShape: c.BodyShape.Set,
		SkinTone: text(c.SkinTone), SetSkinTone: c.SkinTone.Set,
		SkinUndertone: text(c.SkinUndertone), SetSkinUndertone: c.SkinUndertone.Set,
		HairColor: text(c.HairColor), SetHairColor: c.HairColor.Set,
		EyeColor: text(c.EyeColor), SetEyeColor: c.EyeColor.Set,
		ClothingSize: text(c.ClothingSize), SetClothingSize: c.ClothingSize.Set,
		PreferredFit: text(c.PreferredFit), SetPreferredFit: c.PreferredFit.Set,
		TypicalBudget: c.TypicalBudget.Value, SetTypicalBudget: c.TypicalBudget.Set,
	}
}

func preferencesParams(userID string, c PreferencesChange) (store.UpsertUserPreferencesParams, error) {
	params := store.UpsertUserPreferencesParams{ID: platform.NewID(), UserID: userID, Language: c.Language}
	for _, list := range []struct {
		values *[]string
		into   **string
	}{
		{c.PreferredStyles, &params.PreferredStyles},
		{c.DislikedStyles, &params.DislikedStyles},
		{c.FavoriteColors, &params.FavoriteColors},
		{c.DislikedColors, &params.DislikedColors},
	} {
		if list.values == nil {
			continue
		}
		values := *list.values
		if values == nil {
			values = []string{} // stored as [], never as null
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			return store.UpsertUserPreferencesParams{}, fmt.Errorf("encode a preference list: %w", err)
		}
		text := string(encoded)
		*list.into = &text
	}
	return params, nil
}
