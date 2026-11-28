package demo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/auth"
	"lookly/internal/legal"
	"lookly/internal/platform"
	"lookly/internal/session"
	"lookly/internal/storage"
	"lookly/internal/store"
)

// The analysis an item records: given by hand, by this tool, so there is
// nothing for the user to review (the TypeScript seed's values).
const (
	AnalysisProvider = "demo-seed"
	AnalysisModel    = "manual"
	AnalysisVersion  = "demo-seed-1"
)

// The language of the demo user's app.
const language = "uz"

// Timeouts of the transactions and of the removal of files.
const (
	accountTimeout = 30 * time.Second
	itemTimeout    = 10 * time.Second
	removeTimeout  = 30 * time.Second
)

// WardrobeExistsError: the demo account has items, and they were not to be
// replaced. Nothing was changed.
type WardrobeExistsError struct {
	Items int
}

func (e *WardrobeExistsError) Error() string {
	return fmt.Sprintf("demo: the account already has %d items", e.Items)
}

// errChanged: the account changed while the run was preparing its own
// change; a second run sees the new state.
var errChanged = errors.New("the account changed while this run was preparing (was it deleted, or its password changed?); run again")

// Outcome is what a seed did.
type Outcome struct {
	UserID string
	// Created: the account was made by this run; otherwise it existed and
	// was brought to the manifest.
	Created bool
	// Removed is how many earlier items were deleted (reset).
	Removed int
	// Items is how many items were made.
	Items int
	// SessionsEnded is how many of the account's sessions ended because its
	// password changed.
	SessionsEnded int
}

// SeederConfig is what a Seeder works with: the server's database, image
// storage and image pipeline. There is no AI: the manifest says what each
// garment is.
type SeederConfig struct {
	Pool      *pgxpool.Pool
	Images    storage.Store
	Processor Processor
	Log       *slog.Logger
}

// Seeder writes the demo account.
type Seeder struct {
	pool      *pgxpool.Pool
	images    storage.Store
	processor Processor
	log       *slog.Logger
}

// NewSeeder returns a Seeder.
func NewSeeder(c SeederConfig) *Seeder {
	return &Seeder{pool: c.Pool, images: c.Images, processor: c.Processor, log: c.Log}
}

// Seed brings the demo account to the manifest.
//
// The account: made as registration makes one (profile, preferences, the
// current legal version accepted with 18+ confirmed) when the e-mail has
// none; an existing one keeps its id and gets the manifest's name, the
// password and the preferences, with any missing row made. A changed
// password ends the account's sessions, as a password reset does; the same
// password keeps its hash and the sessions.
//
// The wardrobe: an account that has items is refused with
// *WardrobeExistsError, and nothing is changed, unless reset is set: then
// the items go in the account's transaction and their files after its
// commit (as an item's deletion; a file that cannot be removed is logged
// and left to the sweep). Each item is then made as an upload makes one:
// its photo through the image pipeline, the three files stored, the rows
// written in a transaction; a failure removes that item's files and stops
// the run, the items before it staying (run again with reset). The photos
// are meant to have passed Check.
func (s *Seeder) Seed(ctx context.Context, a Account, m Manifest, photos *Photos, reset bool) (Outcome, error) {
	existing, err := store.New(s.pool).UserByEmail(ctx, a.Email)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Outcome{}, fmt.Errorf("look up the account: %w", err)
	}
	// The same password keeps its hash (and the sessions) unless the hash
	// is weaker than the server's cost; a new one is hashed as at
	// registration.
	samePassword := found && auth.VerifyPassword(a.Password, existing.PasswordHash)
	var hash string
	if !samePassword || auth.NeedsRehash(existing.PasswordHash) {
		if hash, err = auth.HashPassword(a.Password); err != nil {
			return Outcome{}, fmt.Errorf("hash the password: %w", err)
		}
	}

	out := Outcome{Created: !found}
	var earlier []string
	if found {
		out.UserID = existing.ID
		earlier, err = s.update(ctx, existing, hash, samePassword, m, reset, &out)
	} else {
		out.UserID = platform.NewID()
		err = s.create(ctx, out.UserID, a.Email, hash, m)
	}
	if err != nil {
		return Outcome{}, err
	}
	if len(earlier) > 0 {
		removeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), removeTimeout)
		defer cancel()
		if err := s.images.Delete(removeCtx, earlier...); err != nil {
			s.log.Warn("demo seed: files of the earlier items not removed; the sweep removes them", "userId", out.UserID, "files", len(earlier), "err", err.Error())
		}
	}

	for i, item := range m.Items {
		if err := s.item(ctx, out.UserID, photos, item); err != nil {
			return out, fmt.Errorf("item %d (%s): %w", i+1, item.File, err)
		}
		out.Items++
	}
	return out, nil
}

// preferences are the manifest's preferences as the rows store them.
func preferences(userID string, m Manifest) store.UpsertUserPreferencesParams {
	return store.UpsertUserPreferencesParams{
		ID: platform.NewID(), UserID: userID, PreferredStyles: ptr(jsonText(m.Preferences.PreferredStyles)),
		FavoriteColors: ptr(jsonText(m.Preferences.FavoriteColors)), Language: ptr(language),
	}
}

// create makes the account as registration does, in one transaction.
func (s *Seeder) create(ctx context.Context, userID, email, hash string, m Manifest) error {
	ctx, cancel := context.WithTimeout(ctx, accountTimeout)
	defer cancel()
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.CreateUser(ctx, store.CreateUserParams{ID: userID, Email: email, Name: &m.Name, PasswordHash: hash}); err != nil {
			return fmt.Errorf("create the user: %w", err)
		}
		if err := q.CreateUserProfile(ctx, store.CreateUserProfileParams{ID: platform.NewID(), UserID: userID}); err != nil {
			return fmt.Errorf("create the profile: %w", err)
		}
		if err := q.UpsertUserPreferences(ctx, preferences(userID, m)); err != nil {
			return fmt.Errorf("create the preferences: %w", err)
		}
		if err := q.CreateLegalConsent(ctx, store.CreateLegalConsentParams{
			ID: platform.NewID(), UserID: userID, Version: legal.Version, AgeConfirmed: true,
		}); err != nil {
			return fmt.Errorf("record the consent: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create the demo account: %w", err)
	}
	return nil
}

// update brings an existing account to the manifest in one transaction
// that takes the session protocol's locks (the user's session families,
// then the user's row). It returns the storage keys of the items it
// deleted, for removal after the commit.
func (s *Seeder) update(ctx context.Context, existing store.UserByEmailRow, hash string, samePassword bool, m Manifest, reset bool, out *Outcome) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, accountTimeout)
	defer cancel()
	id := existing.ID
	var keys []string
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := session.LockUserFamilies(ctx, tx, id); err != nil {
			return err
		}
		if _, err := q.LockUser(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return errChanged
		} else if err != nil {
			return fmt.Errorf("lock the user: %w", err)
		}
		// What was decided before the lock still holds.
		now, err := q.UserByEmail(ctx, existing.Email)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (now.ID != id || now.PasswordHash != existing.PasswordHash)) {
			return errChanged
		} else if err != nil {
			return fmt.Errorf("look up the account: %w", err)
		}
		n, err := q.CountWardrobeItemsOfUser(ctx, id)
		if err != nil {
			return fmt.Errorf("count the items: %w", err)
		}
		if n > 0 && !reset {
			return &WardrobeExistsError{Items: int(n)}
		}

		if err := q.SetUserName(ctx, store.SetUserNameParams{ID: id, Name: &m.Name}); err != nil {
			return fmt.Errorf("set the name: %w", err)
		}
		if hash != "" {
			if err := q.SetPasswordHash(ctx, store.SetPasswordHashParams{ID: id, PasswordHash: hash}); err != nil {
				return fmt.Errorf("set the password: %w", err)
			}
		}
		if !samePassword {
			t, err := q.SessionNow(ctx)
			if err != nil {
				return fmt.Errorf("read the database clock: %w", err)
			}
			if out.SessionsEnded, err = session.RevokeUserFamilies(ctx, tx, id, t.UTC()); err != nil {
				return err
			}
		}
		// A profile is made when there is none; one there is left as it is.
		if err := q.UpsertUserProfile(ctx, store.UpsertUserProfileParams{ID: platform.NewID(), UserID: id}); err != nil {
			return fmt.Errorf("the profile: %w", err)
		}
		if err := q.UpsertUserPreferences(ctx, preferences(id, m)); err != nil {
			return fmt.Errorf("the preferences: %w", err)
		}
		recorded, err := q.ConsentRecorded(ctx, store.ConsentRecordedParams{UserID: id, Version: legal.Version})
		if err != nil {
			return fmt.Errorf("read the consent: %w", err)
		}
		if !recorded {
			if err := q.CreateLegalConsent(ctx, store.CreateLegalConsentParams{
				ID: platform.NewID(), UserID: id, Version: legal.Version, AgeConfirmed: true,
			}); err != nil {
				return fmt.Errorf("record the consent: %w", err)
			}
		}

		if n > 0 {
			images, err := q.ImageKeysOfUsers(ctx, []string{id})
			if err != nil {
				return fmt.Errorf("read the earlier items' files: %w", err)
			}
			for _, img := range images {
				keys = append(keys, img.StorageKey)
				for _, variant := range []*string{img.DisplayKey, img.ThumbnailKey} {
					if variant != nil && *variant != "" {
						keys = append(keys, *variant)
					}
				}
			}
			removed, err := q.DeleteWardrobeItemsOfUser(ctx, id)
			if err != nil {
				return fmt.Errorf("delete the earlier items: %w", err)
			}
			out.Removed = int(removed)
		}
		return nil
	})
	var exists *WardrobeExistsError
	if errors.As(err, &exists) || errors.Is(err, errChanged) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("update the demo account: %w", err)
	}
	return keys, nil
}

// item makes one item as an upload does: the photo through the pipeline,
// its three files, then its rows in a transaction. A failure removes the
// files. (Should a commit be done and its answer lost, the rows would name
// removed files: the run reports the failure, and a run with reset
// replaces that item.)
func (s *Seeder) item(ctx context.Context, userID string, photos *Photos, item Item) (err error) {
	original, variants, err := process(ctx, s.processor, photos, item.File)
	if err != nil {
		return err
	}
	base, err := storage.NewBase(userID)
	if err != nil {
		return err
	}
	master, display, thumbnail := base+"."+variants.Ext, base+"_display.webp", base+"_thumb.webp"
	defer func() {
		if err == nil {
			return
		}
		removeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), removeTimeout)
		defer cancel()
		if removeErr := s.images.Delete(removeCtx, master, display, thumbnail); removeErr != nil {
			s.log.Warn("demo seed: files of a failed item not removed; the sweep removes them", "userId", userID, "err", removeErr.Error())
		}
	}()
	for _, object := range []struct {
		key  string
		data []byte
	}{{master, variants.Master}, {display, variants.Display}, {thumbnail, variants.Thumbnail}} {
		if err = s.images.Put(ctx, object.key, object.data); err != nil {
			return fmt.Errorf("store the picture: %w", err)
		}
	}

	digest := sha256.Sum256(original)
	txCtx, cancel := context.WithTimeout(ctx, itemTimeout)
	defer cancel()
	err = pgx.BeginTxFunc(txCtx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		row, err := q.InsertWardrobeItem(txCtx, store.InsertWardrobeItemParams{
			ID: platform.NewID(), UserID: userID,
			Category: item.Category, Subcategory: item.Subcategory, Colors: jsonText(item.Colors), Pattern: item.Pattern,
			Material: item.Material, SleeveLength: item.SleeveLength, Fit: item.Fit, Style: item.Style,
			Season: jsonText(item.Season), Gender: item.Gender, Formality: item.Formality,
			Confidences:      "{}",
			AnalysisProvider: ptr(AnalysisProvider), AnalysisModel: ptr(AnalysisModel), AnalysisVersion: ptr(AnalysisVersion),
		})
		if err != nil {
			return err
		}
		return q.InsertWardrobeImage(txCtx, store.InsertWardrobeImageParams{
			ID: platform.NewID(), ItemID: row.ID, StorageKey: master, DisplayKey: &display, ThumbnailKey: &thumbnail,
			Width: ptr(int32(variants.Width)), Height: ptr(int32(variants.Height)), MimeType: &variants.MIMEType,
			Bytes: ptr(int32(len(original))), Sha256: ptr(hex.EncodeToString(digest[:])),
		})
	})
	if err != nil {
		return fmt.Errorf("write the item: %w", err)
	}
	return nil
}

// jsonText is a list of catalog ids as JSON text, as the rows store it.
func jsonText(list []string) string {
	b, err := json.Marshal(list)
	if err != nil { // a list of strings always encodes
		panic("demo: encoding a list of strings: " + err.Error())
	}
	return string(b)
}

func ptr[T any](v T) *T { return &v }
