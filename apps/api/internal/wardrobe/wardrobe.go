// Package wardrobe is a user's wardrobe: listing the items, reading one,
// correcting its attributes and deleting it. Every operation names the
// owner; an item of another user does not exist for the caller.
package wardrobe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/storage"
	"lookly/internal/store"
)

var (
	// ErrNotFound: the user has no such item.
	ErrNotFound = errors.New("wardrobe: no such item")
	// ErrSubcategoryMismatch: the subcategory the item would end up with
	// does not belong to its category.
	ErrSubcategoryMismatch = errors.New("wardrobe: the subcategory does not belong to the category")
)

// Image is one stored picture of an item: its storage keys (the master,
// and the variants when it has them).
type Image struct {
	ID           string
	StorageKey   string
	DisplayKey   *string
	ThumbnailKey *string
	IsPrimary    bool
	Width        *int32
	Height       *int32
}

// Item is a wardrobe item with its lists read and its images.
type Item struct {
	ID, UserID, Category                                                        string
	Subcategory, Pattern, Material, SleeveLength, Fit, Style, Gender, Formality *string
	Colors, Season                                                              []string
	Confidences                                                                 map[string]float64
	WasCorrected                                                                bool
	CorrectionLog                                                               []Correction
	Images                                                                      []Image
	CreatedAt, UpdatedAt                                                        time.Time
}

// Page is a page of a user's items; NextCursor is nil on the last one.
type Page struct {
	Items      []Item
	NextCursor *string
}

// removeTimeout bounds the removal of a deleted item's files.
const removeTimeout = 10 * time.Second

// Service is the wardrobe use cases.
type Service struct {
	pool   *pgxpool.Pool
	images storage.Store
	log    *slog.Logger
}

// New returns a Service over the pool; images is where the pictures are.
func New(pool *pgxpool.Pool, images storage.Store, log *slog.Logger) *Service {
	return &Service{pool: pool, images: images, log: log}
}

// List returns a page of the user's items, newest first, of one category
// or (nil) of all. cursor is the id of the last item of the page before;
// one that is not an item of the user's gives an empty last page.
func (s *Service) List(ctx context.Context, userID string, category *string, limit int, cursor *string) (Page, error) {
	q := store.New(s.pool)
	rows, err := q.ListWardrobeItems(ctx, store.ListWardrobeItemsParams{
		UserID: userID, Category: category, CursorID: cursor, RowLimit: int32(limit) + 1,
	})
	if err != nil {
		return Page{}, fmt.Errorf("wardrobe: list: %w", err)
	}
	var page Page
	if len(rows) > limit {
		rows = rows[:limit]
		page.NextCursor = &rows[limit-1].ID
	}
	page.Items, err = withImages(ctx, q, rows)
	return page, err
}

// Get returns one item of the user's. ErrNotFound when there is none.
func (s *Service) Get(ctx context.Context, userID, id string) (Item, error) {
	q := store.New(s.pool)
	row, err := q.WardrobeItemOfUser(ctx, store.WardrobeItemOfUserParams{ID: id, UserId: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, fmt.Errorf("wardrobe: read: %w", err)
	}
	return one(ctx, q, row)
}

// Correct applies a correction: each attribute that differs is written and
// logged, the item is marked corrected, and its updatedAt moves; a patch
// that changes nothing writes nothing. It returns the item after it and the
// corrections made. Concurrent corrections of an item go one at a time, so
// none loses the other's log entries. ErrNotFound, ErrSubcategoryMismatch.
func (s *Service) Correct(ctx context.Context, userID, id string, p Patch) (Item, []Correction, error) {
	var item Item
	var made []Correction
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		row, err := q.LockWardrobeItemOfUser(ctx, store.LockWardrobeItemOfUserParams{ID: id, UserId: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if subcategoryMismatch(row, p) {
			return ErrSubcategoryMismatch
		}
		now, err := q.WardrobeNow(ctx)
		if err != nil {
			return err
		}
		var c change
		made, c = corrections(row, p, now.UTC().Format("2006-01-02T15:04:05.000Z"))
		if !c.empty() {
			log, err := appendLog(row, made)
			if err != nil {
				return err
			}
			row, err = q.UpdateWardrobeItem(ctx, c.params(id, log, now))
			if err != nil {
				return err
			}
		}
		item, err = one(ctx, q, row)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrSubcategoryMismatch) {
			return Item{}, nil, err
		}
		return Item{}, nil, fmt.Errorf("wardrobe: correct: %w", err)
	}
	return item, made, nil
}

// Delete removes an item of the user's with its image rows and outfit
// entries, then its image files. The files go after the rows are gone: one
// that cannot be removed is logged and left to the sweep, and the item is
// deleted all the same. ErrNotFound when there is none.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	var keys []string
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if _, err := q.LockWardrobeItemOfUser(ctx, store.LockWardrobeItemOfUserParams{ID: id, UserId: userID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		images, err := q.WardrobeImagesOfItems(ctx, []string{id})
		if err != nil {
			return err
		}
		for _, img := range images {
			keys = append(keys, img.StorageKey)
			for _, variant := range []*string{img.DisplayKey, img.ThumbnailKey} {
				if variant != nil && *variant != "" {
					keys = append(keys, *variant)
				}
			}
		}
		return q.DeleteWardrobeItem(ctx, id)
	})
	if errors.Is(err, ErrNotFound) {
		return err
	}
	if err != nil {
		return fmt.Errorf("wardrobe: delete: %w", err)
	}
	// The request may end (the client left) while the files are removed.
	removeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), removeTimeout)
	defer cancel()
	if err := s.images.Delete(removeCtx, keys...); err != nil {
		s.log.Warn("wardrobe: files of a deleted item not removed; the sweep removes them", "itemId", id, "userId", userID, "files", len(keys), "err", err.Error())
	}
	return nil
}

// appendLog is the item's correction log with the new entries, as JSON
// text. The entries already there are kept as they are stored.
func appendLog(row store.WardrobeItem, made []Correction) (string, error) {
	var log []json.RawMessage
	if err := json.Unmarshal([]byte(row.CorrectionLog), &log); err != nil {
		return "", fmt.Errorf("the stored correctionLog of item %s is not a JSON list", row.ID)
	}
	for _, c := range made {
		log = append(log, json.RawMessage(jsonText(c)))
	}
	return jsonText(log), nil
}

func (c change) params(id, log string, now time.Time) store.UpdateWardrobeItemParams {
	p := store.UpdateWardrobeItemParams{
		ID: id, CorrectionLog: log, UpdatedAt: now,
		SetSubcategory: c.subcategory.Set, Subcategory: c.subcategory.Value,
		SetPattern: c.pattern.Set, Pattern: c.pattern.Value,
		SetMaterial: c.material.Set, Material: c.material.Value,
		SetSleeveLength: c.sleeveLength.Set, SleeveLength: c.sleeveLength.Value,
		SetFit: c.fit.Set, Fit: c.fit.Value,
		SetStyle: c.style.Set, Style: c.style.Value,
		SetGender: c.gender.Set, Gender: c.gender.Value,
		SetFormality: c.formality.Set, Formality: c.formality.Value,
	}
	if c.category != nil {
		p.SetCategory, p.Category = true, *c.category
	}
	if c.colors != nil {
		p.SetColors, p.Colors = true, *c.colors
	}
	if c.season != nil {
		p.SetSeason, p.Season = true, *c.season
	}
	return p
}

func one(ctx context.Context, q *store.Queries, row store.WardrobeItem) (Item, error) {
	items, err := withImages(ctx, q, []store.WardrobeItem{row})
	if err != nil {
		return Item{}, err
	}
	return items[0], nil
}

// withImages reads the rows' lists and attaches their images, in the order
// of the rows.
func withImages(ctx context.Context, q *store.Queries, rows []store.WardrobeItem) ([]Item, error) {
	items := make([]Item, len(rows))
	if len(rows) == 0 {
		return items, nil
	}
	ids := make([]string, len(rows))
	index := make(map[string]int, len(rows))
	for i, row := range rows {
		item, err := itemOf(row)
		if err != nil {
			return nil, err
		}
		items[i], ids[i], index[row.ID] = item, row.ID, i
	}
	images, err := q.WardrobeImagesOfItems(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("wardrobe: images: %w", err)
	}
	for _, img := range images {
		i := index[img.WardrobeItemId]
		items[i].Images = append(items[i].Images, Image{
			ID: img.ID, StorageKey: img.StorageKey, DisplayKey: img.DisplayKey, ThumbnailKey: img.ThumbnailKey,
			IsPrimary: img.IsPrimary, Width: img.Width, Height: img.Height,
		})
	}
	return items, nil
}

// itemOf reads a stored row, whose lists, confidences and log are JSON text
// until the cutover (B7). Only this server and the Next.js API write them,
// from validated values: text of another shape is an error, not an empty
// value.
func itemOf(row store.WardrobeItem) (Item, error) {
	item := Item{
		ID: row.ID, UserID: row.UserId, Category: row.Category,
		Subcategory: row.Subcategory, Pattern: row.Pattern, Material: row.Material, SleeveLength: row.SleeveLength,
		Fit: row.Fit, Style: row.Style, Gender: row.Gender, Formality: row.Formality,
		WasCorrected: row.WasCorrected, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		Images: []Image{},
	}
	for _, column := range []struct {
		name, text string
		into       any
		missing    func() bool
	}{
		{"colors", row.Colors, &item.Colors, func() bool { return item.Colors == nil }},
		{"season", row.Season, &item.Season, func() bool { return item.Season == nil }},
		{"confidences", row.Confidences, &item.Confidences, func() bool { return item.Confidences == nil }},
		{"correctionLog", row.CorrectionLog, &item.CorrectionLog, func() bool { return item.CorrectionLog == nil }},
	} {
		if err := json.Unmarshal([]byte(column.text), column.into); err != nil || column.missing() {
			return Item{}, fmt.Errorf("wardrobe: the stored %s of item %s is not the JSON it should be", column.name, row.ID)
		}
	}
	return item, nil
}
