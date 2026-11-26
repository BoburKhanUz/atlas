//go:build integration

package wardrobe_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/storage"
	"lookly/internal/wardrobe"
	"lookly/migrations"
)

// sweepWorld is a database, a storage directory and the sweep over them,
// at a fixed time.
type sweepWorld struct {
	t      *testing.T
	pool   *pgxpool.Pool
	root   string
	images storage.Store
	log    *bytes.Buffer
	now    time.Time
	items  int
}

func newSweepWorld(t *testing.T) *sweepWorld {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	return &sweepWorld{t: t, pool: pool, root: root, images: local, log: &bytes.Buffer{}, now: time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)}
}

func (w *sweepWorld) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), sql, args...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
}

func (w *sweepWorld) user(id string) {
	w.t.Helper()
	w.exec(`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $1 || '@test.local', 'x', now()) ON CONFLICT DO NOTHING`, id)
}

// file stores a file of the given age under users/.
func (w *sweepWorld) file(key string, age time.Duration) {
	w.t.Helper()
	path := filepath.Join(w.root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("image"), 0o644); err != nil {
		w.t.Fatal(err)
	}
	at := w.now.Add(-age)
	if err := os.Chtimes(path, at, at); err != nil {
		w.t.Fatal(err)
	}
}

// image stores an item of the user with an image row naming the keys ("" for none).
func (w *sweepWorld) image(user, master, display, thumbnail string) {
	w.t.Helper()
	w.user(user)
	w.items++
	item := fmt.Sprintf("item%d", w.items)
	w.exec(`INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt") VALUES ($1,$2,'shirt',now())`, item, user)
	w.exec(`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","displayKey","thumbnailKey") VALUES ($1,$2,$3,nullif($4,''),nullif($5,''))`,
		"img"+item, item, master, display, thumbnail)
}

func (w *sweepWorld) sweep() (wardrobe.SweepReport, error) {
	w.t.Helper()
	sweeper := wardrobe.NewSweeper(w.pool, w.images, slog.New(slog.NewJSONHandler(w.log, nil)), func() time.Time { return w.now })
	return sweeper.Sweep(context.Background())
}

func (w *sweepWorld) stored() []string {
	w.t.Helper()
	var keys []string
	err := filepath.WalkDir(w.root, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(w.root, path)
			keys = append(keys, filepath.ToSlash(rel))
		}
		return err
	})
	if err != nil {
		w.t.Fatal(err)
	}
	slices.Sort(keys)
	return keys
}

func key(owner string, n int, suffix string) string {
	return fmt.Sprintf("users/%s/%08x-4e5f-4a6b-8c7d-9e0f1a2b3c4d%s", owner, n, suffix)
}

func TestSweepRemovesOldFilesNothingNamesAndNothingElse(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	old, young := 2*time.Hour, 10*time.Minute

	// Named by image rows: kept, however old. With and without variants.
	w.image("u_one", key("u_one", 1, ".jpg"), key("u_one", 1, "_display.webp"), key("u_one", 1, "_thumb.webp"))
	w.image("u_one", key("u_one", 2, ".png"), "", key("u_one", 2, "_thumb.jpg"))
	w.image("u_two", key("u_two", 3, ".webp"), key("u_two", 3, "_display.webp"), "")
	kept := []string{
		key("u_one", 1, ".jpg"), key("u_one", 1, "_display.webp"), key("u_one", 1, "_thumb.webp"),
		key("u_one", 2, ".png"), key("u_one", 2, "_thumb.jpg"),
		key("u_two", 3, ".webp"), key("u_two", 3, "_display.webp"),
	}
	for _, k := range kept {
		w.file(k, 30*24*time.Hour)
	}
	// Orphans, old: a crashed upload of a user with other items, a variant
	// left by a rollback, the files of a user without any item, and of an
	// owner the database does not know (a deleted account).
	orphans := []string{
		key("u_one", 9, ".jpg"), key("u_one", 9, "_display.webp"), key("u_one", 9, "_thumb.webp"),
		key("u_one", 2, "_display.webp"),
		key("u_two", 8, ".jpg"),
		key("u_gone", 7, ".jpg"), key("u_gone", 7, "_thumb.webp"),
	}
	for _, k := range orphans {
		w.file(k, old)
	}
	// Exactly an hour old is old enough.
	edge := key("u_two", 6, ".jpg")
	w.file(edge, time.Hour)
	// Young and unnamed: an upload may still be committing.
	recent := []string{key("u_one", 5, ".jpg"), key("u_new", 4, ".jpg"), key("u_two", 5, "_thumb.webp")}
	for _, k := range recent {
		w.file(k, young)
	}
	w.file(key("u_two", 10, ".jpg"), time.Hour-time.Second)
	recent = append(recent, key("u_two", 10, ".jpg"))
	// Names the server never makes: never removed, however old.
	unknown := []string{"users/u_one/notes.txt", "users/u_one/" + strings.Repeat("a", 36) + ".jpg", "users/u_two/.upload-123", "users/u_one/00000001-4e5f-4a6b-8c7d-9e0f1a2b3c4d.gif"}
	for _, k := range unknown {
		w.file(k, old)
	}
	// Outside users/: not the sweep's at all.
	w.file("README.txt", old)

	report, err := w.sweep()
	if err != nil {
		t.Fatal(err)
	}
	want := wardrobe.SweepReport{Files: len(kept) + len(orphans) + 1 + len(recent) + len(unknown), Referenced: len(kept), Recent: len(recent), Removed: len(orphans) + 1, Unknown: len(unknown)}
	if report != want {
		t.Errorf("report %+v, want %+v", report, want)
	}
	left := slices.Concat(kept, recent, unknown, []string{"README.txt"})
	slices.Sort(left)
	if got := w.stored(); !slices.Equal(got, left) {
		t.Errorf("stored after the sweep:\n got %v\nwant %v", got, left)
	}
	for _, name := range unknown {
		if !strings.Contains(w.log.String(), name) {
			t.Errorf("the unknown name %s is not reported: %s", name, w.log.String())
		}
	}
	// A second sweep finds nothing to do.
	again, err := w.sweep()
	if err != nil || again.Removed != 0 || again.Referenced != len(kept) {
		t.Errorf("the second sweep: %+v, %v", again, err)
	}
}

// A file named by an image row of another user's item is not that file:
// keys are whole strings, and a row keeps exactly the keys it names.
func TestSweepKeepsOnlyWhatARowNamesExactly(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	w.image("u_one", key("u_one", 1, ".jpg"), "", "")
	w.user("u_two")
	w.image("u_two", key("u_two", 2, ".jpg"), "", "")
	// The same file name under another owner, and other variants of a named master.
	for _, k := range []string{key("u_one", 1, ".jpg"), key("u_two", 1, ".jpg"), key("u_one", 1, ".png"), key("u_one", 1, "_thumb.webp"), key("u_two", 2, ".jpg")} {
		w.file(k, 2*time.Hour)
	}
	report, err := w.sweep()
	if err != nil {
		t.Fatal(err)
	}
	if got := w.stored(); !slices.Equal(got, []string{key("u_one", 1, ".jpg"), key("u_two", 2, ".jpg")}) || report.Removed != 3 {
		t.Errorf("stored %v, report %+v", got, report)
	}
}

// A database without a single image row before a storage with old files is
// taken for the wrong database: nothing is removed.
func TestSweepRefusesToEmptyTheStorageForAnEmptyDatabase(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	files := []string{key("u_one", 1, ".jpg"), key("u_one", 1, "_thumb.webp"), key("u_two", 2, ".png")}
	for _, k := range files {
		w.file(k, 2*time.Hour)
	}
	report, err := w.sweep()
	if !errors.Is(err, wardrobe.ErrSweepRefused) || report.Removed != 0 {
		t.Fatalf("report %+v, err %v", report, err)
	}
	if got := w.stored(); !slices.Equal(got, files) {
		t.Fatalf("stored %v", got)
	}
	// With young files only there is nothing to refuse.
	young := newSweepWorld(t)
	young.file(key("u_one", 1, ".jpg"), time.Minute)
	if report, err := young.sweep(); err != nil || report.Recent != 1 {
		t.Fatalf("young files only: %+v, %v", report, err)
	}
	// One image row anywhere, and the orphans are orphans.
	w.image("u_three", key("u_three", 3, ".jpg"), "", "")
	report, err = w.sweep()
	if err != nil || report.Removed != len(files) || len(w.stored()) != 0 {
		t.Fatalf("with an image row: %+v, %v, stored %v", report, err, w.stored())
	}
}

// One run removes a bounded number of files; the rest waits for the next.
func TestSweepRemovesABoundedNumberPerRun(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	w.image("u_keep", key("u_keep", 1, ".jpg"), "", "")
	w.file(key("u_keep", 1, ".jpg"), 2*time.Hour)
	// More owners than one batch asks about, more orphans than one run removes.
	const owners, perOwner = 60, 20
	total := owners * perOwner
	for o := range owners {
		for n := range perOwner {
			w.file(key(fmt.Sprintf("u_%03d", o), n, ".jpg"), 2*time.Hour)
		}
	}
	report, err := w.sweep()
	if err != nil {
		t.Fatal(err)
	}
	if report.Removed != wardrobe.SweepMaxRemovals || report.NotRemoved != total-wardrobe.SweepMaxRemovals || report.Referenced != 1 || len(w.stored()) != total+1-wardrobe.SweepMaxRemovals {
		t.Fatalf("first run: %+v, %d stored", report, len(w.stored()))
	}
	report, err = w.sweep()
	if err != nil || report.Removed != total-wardrobe.SweepMaxRemovals || report.NotRemoved != 0 {
		t.Fatalf("second run: %+v, %v", report, err)
	}
	if got := w.stored(); !slices.Equal(got, []string{key("u_keep", 1, ".jpg")}) {
		t.Fatalf("stored %v", got)
	}
}

// undeletable is a store that cannot remove one of its files.
type undeletable struct {
	storage.Store
	key string
}

func (s undeletable) Delete(ctx context.Context, keys ...string) error {
	if slices.Contains(keys, s.key) {
		return errors.New("permission denied")
	}
	return s.Store.Delete(ctx, keys...)
}

// A file that cannot be removed is reported and does not stop the others.
func TestSweepGoesOnWhenAFileCannotBeRemoved(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	w.image("u_keep", key("u_keep", 1, ".jpg"), "", "")
	stuck := key("u_one", 2, ".jpg")
	for _, k := range []string{key("u_one", 1, ".jpg"), stuck, key("u_one", 3, ".jpg")} {
		w.file(k, 2*time.Hour)
	}
	w.images = undeletable{w.images, stuck}
	report, err := w.sweep()
	if err != nil || report.Removed != 2 || report.NotRemoved != 1 {
		t.Fatalf("report %+v, err %v", report, err)
	}
	if got := w.stored(); !slices.Equal(got, []string{stuck}) {
		t.Fatalf("stored %v", got)
	}
	if !strings.Contains(w.log.String(), stuck) || !strings.Contains(w.log.String(), "permission denied") {
		t.Errorf("the failure is not logged: %s", w.log.String())
	}
}

// brokenListing is a store that cannot be listed.
type brokenListing struct{ storage.Store }

func (brokenListing) List(context.Context, func(storage.Object) error) error {
	return errors.New("the bucket does not answer")
}

func TestSweepFailsWhenTheStorageCannotBeListed(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	w.images = brokenListing{w.images}
	if _, err := w.sweep(); err == nil || !strings.Contains(err.Error(), "the bucket does not answer") {
		t.Fatalf("err %v", err)
	}
}

// The limits are part of the sweep's safety.
func TestSweepLimits(t *testing.T) {
	t.Parallel()
	if wardrobe.SweepMinAge != time.Hour || wardrobe.SweepMaxRemovals != 1000 {
		t.Fatalf("minimum age %s, at most %d removals", wardrobe.SweepMinAge, wardrobe.SweepMaxRemovals)
	}
}
