package wardrobe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/platform"
	"lookly/internal/ratelimit"
	"lookly/internal/storage"
	"lookly/internal/store"
	"lookly/internal/vision"
)

// The limits of one user (owner decision, 2026-11-26).
const (
	// MaxItems is how many items a wardrobe holds.
	MaxItems = 1000
	// DailyUploads is how many pictures a user uploads in a day of
	// Uzbekistan time.
	DailyUploads = 100
)

// UploadRoute names the upload in the idempotency keys, as the Next.js API
// names it.
const UploadRoute = "POST /api/v1/wardrobe/items"

var (
	// ErrWardrobeFull: the user has MaxItems items.
	ErrWardrobeFull = errors.New("wardrobe: the wardrobe is full")
	// ErrReplayGone: the request was completed earlier, and the item it
	// created has been deleted since.
	ErrReplayGone = errors.New("wardrobe: the item this request created was deleted")
	// ErrNoUser: the account does not exist (any more).
	ErrNoUser = errors.New("wardrobe: no such user")
	// ErrOutcomeUnknown: the item's rows were written and their commit did
	// not report success; the item was not found afterwards, or could not
	// be looked up. The stored files and the day's count were left.
	ErrOutcomeUnknown = errors.New("wardrobe: whether the item was created is not known")
)

// DailyLimitError: the user has uploaded DailyUploads pictures today.
type DailyLimitError struct {
	// RetryAfter is the time to the next day in Uzbekistan.
	RetryAfter time.Duration
}

func (e *DailyLimitError) Error() string { return "wardrobe: today's uploads are used up" }

// Upload is one uploaded picture.
type Upload struct {
	UserID string
	// File is the picture as it was sent; FileName the name it was sent
	// under (part of the request's identity).
	File     []byte
	FileName string
	// HintName is the name the development mock reads a category from.
	HintName string
	// Fields are the other text fields of the form (part of the request's
	// identity).
	Fields map[string]string
	// IdempotencyKey is the request's key, or "" when it carries none.
	IdempotencyKey string
}

// Created is the outcome of an upload.
type Created struct {
	Item      Item
	Detection vision.Detection
	// Replayed: the request had been completed before; this is its item
	// as it is now, and nothing was created.
	Replayed bool
}

// Processor checks and converts a picture (*imaging.Processor).
type Processor interface {
	Process(ctx context.Context, data []byte) (imaging.Variants, error)
}

// Uploads creates items from uploaded pictures.
type Uploads struct {
	pool      *pgxpool.Pool
	images    storage.Store
	processor Processor
	limiter   *ratelimit.Limiter
	keys      *idempotency.Service
	log       *slog.Logger
	// inTx runs the transaction that creates an item's rows.
	inTx func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error
}

// UploadsConfig is what Uploads works with.
type UploadsConfig struct {
	Pool      *pgxpool.Pool
	Images    storage.Store
	Processor Processor
	Limiter   *ratelimit.Limiter
	Keys      *idempotency.Service
	Log       *slog.Logger
}

// NewUploads returns the upload use case.
func NewUploads(c UploadsConfig) *Uploads {
	return &Uploads{
		pool: c.Pool, images: c.Images, processor: c.Processor, limiter: c.Limiter, keys: c.Keys, log: c.Log,
		inTx: func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
			return pgx.BeginTxFunc(ctx, pool, options, fn)
		},
	}
}

// uzbekistanOffset is the zone the upload day is counted in: UTC+5, no
// daylight saving (the Next.js quota's day).
const uzbekistanOffset = 5 * time.Hour

// uploadDay is the daily rule: the day is part of the subject, so each day
// has its own count, and a count is forgotten a day after its first upload.
var uploadDay = ratelimit.Rule{Name: "wardrobe:upload:day", Limit: DailyUploads, Window: 24 * time.Hour}

// DailyUploadHit is one upload of the user's on the day (of Uzbekistan
// time) that now falls on, as the rate limiter counts it.
func DailyUploadHit(userID string, now time.Time) ratelimit.Hit {
	return uploadDay.For(userID + " " + now.UTC().Add(uzbekistanOffset).Format(time.DateOnly))
}

// Create checks, stores and analyses an uploaded picture and creates its
// item, in this order: the claim on the idempotency key; the picture's
// header (format, dimensions); the wardrobe's size; the day's count; the
// processing; the files; the rows. Nothing is left behind by a failure: no
// row, no file, no claim on the key. The attempt is given back to the day
// too, with one exception: a picture whose header passed and whose pixels
// did not decode stays counted, because it took a processing slot (else a
// stream of such files would keep the slots busy at no cost).
//
// One failure is of another kind: the rows were written and the commit did
// not report success (a timeout during the commit, a lost connection). The
// commit may have been done, or may still be done. The item is looked up:
// if it is there, the upload succeeded; if not, nothing is taken back, the
// files and the count are kept for the sweep to judge (it asks the database
// before it removes a file), and the error says so (ErrOutcomeUnknown). The
// claim on the key is released if the database lets its row go within the
// cleanup's time (the commit was lost: a retry runs at once); a commit
// still on its way then keeps it, and completes it when it lands (if that
// commit is lost after all, the key stays "in progress" until it is taken
// for crashed, five minutes after it was claimed).
//
// The refusals: imaging.ErrUnsupported, imaging.ErrInvalid and
// imaging.ErrDimensions for the picture; ErrWardrobeFull and
// *DailyLimitError for the limits; idempotency.ErrMismatch and
// *idempotency.InProgressError for the key; ErrReplayGone; ErrNoUser.
func (u *Uploads) Create(ctx context.Context, up Upload) (Created, error) {
	var claim *idempotency.Claim
	if up.IdempotencyKey != "" {
		c, replay, err := u.keys.Begin(ctx, idempotency.Request{
			UserID: up.UserID, Route: UploadRoute, Key: up.IdempotencyKey,
			Hash: idempotency.MultipartHash(up.File, up.FileName, up.Fields),
		})
		if err != nil {
			// The key's row names its user: an account deleted since the
			// gate let the request in cannot hold one.
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == foreignKeyViolation {
				return Created{}, ErrNoUser
			}
			return Created{}, err
		}
		if replay != nil {
			return u.replay(ctx, up.UserID, replay)
		}
		claim = c
	}

	created, undo, err := u.create(ctx, up, claim)
	if err != nil {
		if panicked := (*imaging.DecoderPanic)(nil); errors.As(err, &panicked) {
			// The picture is refused as unreadable; that a decoder fell
			// over it is ours to know.
			u.log.Error("wardrobe: a decoder panicked on an uploaded picture", "userId", up.UserID, "panic", panicked.Value, "stack", string(panicked.Stack))
		}
		// What the attempt took is given back whatever became of the
		// request (the client may have left).
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), removeTimeout)
		defer cancel()
		undo(cleanup, err)
		// The claim is released whatever the failure. After an unknown
		// outcome: a lost commit has let the key's row go, and the key is
		// freed for the retry; a commit that landed has completed the key,
		// which the release leaves alone; a commit still on its way holds
		// the row, and the release gives up when the cleanup's time is up.
		if claim != nil {
			if releaseErr := u.keys.Release(cleanup, *claim); releaseErr != nil {
				u.log.Warn("wardrobe: an idempotency key of a failed upload not released; a commit still on its way completes it, else it is taken for crashed five minutes after its claim",
					"userId", up.UserID, "err", releaseErr.Error())
			}
		}
		return Created{}, err
	}
	return created, nil
}

// replay answers a request completed earlier with its item as it is now.
func (u *Uploads) replay(ctx context.Context, userID string, r *idempotency.Replay) (Created, error) {
	if r.ResourceID == nil {
		return Created{}, ErrReplayGone
	}
	q := store.New(u.pool)
	row, err := q.WardrobeItemOfUser(ctx, store.WardrobeItemOfUserParams{ID: *r.ResourceID, UserId: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Created{}, ErrReplayGone
	}
	if err != nil {
		return Created{}, fmt.Errorf("wardrobe: read the replayed item: %w", err)
	}
	item, err := one(ctx, q, row)
	if err != nil {
		return Created{}, err
	}
	return Created{Item: item, Detection: detectionOf(item, row.AnalysisProvider), Replayed: true}, nil
}

// detectionOf is the detection as the item stores it (a replay answers
// with it): the attributes as they are now, corrections included.
func detectionOf(item Item, provider *string) vision.Detection {
	return vision.Detection{
		Category: item.Category, Subcategory: item.Subcategory, Colors: item.Colors, Pattern: item.Pattern, Material: item.Material,
		SleeveLength: item.SleeveLength, Fit: item.Fit, Style: item.Style, Season: item.Season, Gender: item.Gender,
		Formality: item.Formality, Confidence: item.Confidences,
		Mock: provider == nil || *provider == vision.MockProvider,
	}
}

// foreignKeyViolation is PostgreSQL's error code for a row that names a row
// which is not there.
const foreignKeyViolation = "23503"

// createTimeout bounds the transaction that creates the item's rows. It
// runs to its end whatever becomes of the request: once the files are
// stored, a request that ends while the commit is on its way must not leave
// the caller guessing whether the item exists.
const createTimeout = 10 * time.Second

// create does the work of an upload that holds its claim. On failure, undo
// gives back what was taken so far (the day's count, the stored files),
// given the failure.
func (u *Uploads) create(ctx context.Context, up Upload, claim *idempotency.Claim) (created Created, undo func(ctx context.Context, cause error), err error) {
	var undos []func(context.Context, error)
	undo = func(ctx context.Context, cause error) {
		if errors.Is(cause, ErrOutcomeUnknown) {
			return // the item may exist: its files and its count stay
		}
		for i := len(undos) - 1; i >= 0; i-- {
			undos[i](ctx, cause)
		}
	}
	q := store.New(u.pool)

	// What the picture's header says is judged first: a file that is no
	// picture we take is refused whatever the limits say, without being
	// counted and without waiting for a processing slot.
	if err := imaging.Inspect(up.File); err != nil {
		return Created{}, undo, err
	}

	// A full wardrobe is refused before any work; the count that decides
	// is taken again under the user's lock, with the item's creation.
	count, err := q.CountWardrobeItemsOfUser(ctx, up.UserID)
	if err != nil {
		return Created{}, undo, fmt.Errorf("wardrobe: count items: %w", err)
	}
	if count >= MaxItems {
		return Created{}, undo, ErrWardrobeFull
	}

	now, err := q.WardrobeNow(ctx)
	if err != nil {
		return Created{}, undo, fmt.Errorf("wardrobe: clock: %w", err)
	}
	today := DailyUploadHit(up.UserID, now)
	decision, err := u.limiter.Take(ctx, today)
	if err != nil {
		return Created{}, undo, fmt.Errorf("wardrobe: count the upload: %w", err)
	}
	if !decision.Allowed {
		local := now.UTC().Add(uzbekistanOffset)
		midnight := local.Truncate(24 * time.Hour).Add(24 * time.Hour)
		return Created{}, undo, &DailyLimitError{RetryAfter: max(midnight.Sub(local), time.Second)}
	}
	undos = append(undos, func(ctx context.Context, cause error) {
		if errors.Is(cause, imaging.ErrInvalid) {
			return // it took a processing slot: counted
		}
		if err := u.limiter.Refund(ctx, today); err != nil {
			u.log.Warn("wardrobe: a failed upload stays counted against the day", "userId", up.UserID, "err", err.Error())
		}
	})

	variants, err := u.processor.Process(ctx, up.File)
	if err != nil {
		return Created{}, undo, err
	}

	base, err := storage.NewBase(up.UserID)
	if err != nil {
		return Created{}, undo, err
	}
	master, display, thumbnail := base+"."+variants.Ext, base+"_display.webp", base+"_thumb.webp"
	undos = append(undos, func(ctx context.Context, _ error) {
		if err := u.images.Delete(ctx, master, display, thumbnail); err != nil {
			u.log.Warn("wardrobe: files of a failed upload not removed; the sweep removes them", "userId", up.UserID, "err", err.Error())
		}
	})
	for _, object := range []struct {
		key  string
		data []byte
	}{{master, variants.Master}, {display, variants.Display}, {thumbnail, variants.Thumbnail}} {
		if err := u.images.Put(ctx, object.key, object.data); err != nil {
			return Created{}, undo, fmt.Errorf("wardrobe: store the picture: %w", err)
		}
	}

	detection := vision.Mock(variants.Sample, up.HintName)
	digest := sha256.Sum256(up.File)
	image := store.InsertWardrobeImageParams{
		ID: platform.NewID(), StorageKey: master, DisplayKey: &display, ThumbnailKey: &thumbnail,
		Width: ptr(int32(variants.Width)), Height: ptr(int32(variants.Height)), MimeType: &variants.MIMEType,
		Bytes: ptr(int32(len(up.File))), Sha256: ptr(hex.EncodeToString(digest[:])),
	}

	var item Item
	itemID := platform.NewID()
	// written: every row was written; only the commit was left to do.
	written := false
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), createTimeout)
	defer cancel()
	err = u.inTx(ctx, u.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) (err error) {
		defer func() { written = err == nil }()
		q := store.New(tx)
		// The user's uploads go one at a time from here on, so the count
		// below is the wardrobe's, and not while the account is deleted.
		if _, err := q.LockUser(ctx, up.UserID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNoUser
			}
			return err
		}
		count, err := q.CountWardrobeItemsOfUser(ctx, up.UserID)
		if err != nil {
			return err
		}
		if count >= MaxItems {
			return ErrWardrobeFull
		}
		row, err := q.InsertWardrobeItem(ctx, store.InsertWardrobeItemParams{
			ID: itemID, UserID: up.UserID,
			Category: detection.Category, Subcategory: detection.Subcategory, Colors: jsonText(detection.Colors),
			Pattern: detection.Pattern, Material: detection.Material, SleeveLength: detection.SleeveLength, Fit: detection.Fit,
			Style: detection.Style, Season: jsonText(detection.Season), Gender: detection.Gender, Formality: detection.Formality,
			Confidences:      confidencesText(detection.Confidence),
			AnalysisProvider: ptr(vision.MockProvider), AnalysisModel: ptr(vision.MockModel), AnalysisVersion: ptr(vision.MockVersion),
		})
		if err != nil {
			return err
		}
		image.ItemID = row.ID
		if err := q.InsertWardrobeImage(ctx, image); err != nil {
			return err
		}
		if claim != nil {
			if err := idempotency.Complete(ctx, q, *claim, row.ID, 201); err != nil {
				return err
			}
		}
		item, err = one(ctx, q, row)
		return err
	})
	if err != nil {
		for _, refusal := range []error{ErrNoUser, ErrWardrobeFull, idempotency.ErrClaimLost} {
			if errors.Is(err, refusal) {
				return Created{}, undo, err
			}
		}
		if !written {
			// A failure before the commit: rolled back for certain.
			return Created{}, undo, fmt.Errorf("wardrobe: create the item: %w", err)
		}
		// The commit did not report success: it may have been done, or may
		// still be done (a database finishes a commit it has begun).
		found, lookErr := u.created(ctx, up.UserID, itemID)
		if found == nil { // not there (yet), or the look-up failed too
			lookup := "not found"
			if lookErr != nil {
				lookup = lookErr.Error()
			}
			u.log.Error("wardrobe: an upload's item may or may not exist; its files are left to the sweep",
				"userId", up.UserID, "itemId", itemID, "err", err.Error(), "lookup", lookup)
			return Created{}, undo, fmt.Errorf("%w: %w", ErrOutcomeUnknown, err)
		}
		u.log.Warn("wardrobe: an upload's transaction reported a failure after its commit", "userId", up.UserID, "itemId", itemID, "err", err.Error())
		item = *found
	}
	return Created{Item: item, Detection: detection}, undo, nil
}

// created looks an item up after its commit failed: nil when it is not
// there (yet). It asks with time of its own; the transaction's may be used up.
func (u *Uploads) created(ctx context.Context, userID, itemID string) (*Item, error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), removeTimeout)
	defer cancel()
	q := store.New(u.pool)
	row, err := q.WardrobeItemOfUser(ctx, store.WardrobeItemOfUserParams{ID: itemID, UserId: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item, err := one(ctx, q, row)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// confidencesText is the confidences as the Next.js API stores them: a JSON
// object with the attributes in the mock's order.
func confidencesText(confidence map[string]float64) string {
	var b strings.Builder
	b.WriteByte('{')
	written := 0
	for _, name := range vision.ConfidenceOrder {
		value, ok := confidence[name]
		if !ok {
			continue
		}
		if written > 0 {
			b.WriteByte(',')
		}
		b.WriteString(jsonText(name) + ":" + strconv.FormatFloat(value, 'g', -1, 64))
		written++
	}
	if written != len(confidence) {
		return jsonText(confidence) // attributes the order does not know: by name
	}
	b.WriteByte('}')
	return b.String()
}

func ptr[T any](v T) *T { return &v }
