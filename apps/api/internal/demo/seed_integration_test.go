//go:build integration

package demo_test

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

	"lookly/internal/accounts"
	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/dbtest"
	"lookly/internal/demo"
	"lookly/internal/imaging"
	"lookly/internal/legal"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
	"lookly/internal/storage"
	"lookly/internal/wardrobe"
	"lookly/migrations"
)

// world is a migrated database, a local storage directory and a folder
// with a manifest and its photos.
type world struct {
	t      *testing.T
	pool   *pgxpool.Pool
	root   string // the storage directory
	images *storage.Local
	dir    string // the manifest's folder
	log    *bytes.Buffer
}

func newWorld(t *testing.T) *world {
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
	return &world{t: t, pool: pool, root: root, images: local, dir: t.TempDir(), log: &bytes.Buffer{}}
}

// photo copies a fixture image into the manifest's folder under name.
func (w *world) photo(fixture, name string) {
	w.t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "images", fixture))
	if err != nil {
		w.t.Fatal(err)
	}
	path := filepath.Join(w.dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		w.t.Fatal(err)
	}
}

// The three photos of the first manifest and the two of the second.
var (
	threeItems = `{
	  "name": "  Dilnoza ",
	  "preferences": {"preferredStyles": ["smart_casual", "minimal"], "favoriteColors": ["white", "navy"]},
	  "items": [
	    {"file": "photos/shirt.png", "category": "shirt", "subcategory": "tshirt", "colors": ["white"], "pattern": "solid", "material": "cotton",
	     "sleeveLength": "short", "fit": "regular", "style": "casual", "season": ["spring", "summer"], "gender": "unisex", "formality": "casual"},
	    {"file": "photos/jeans.jpg", "category": "pants", "subcategory": "jeans", "colors": ["navy", "blue"], "season": ["autumn"]},
	    {"file": "photos/shoes.png", "category": "shoes", "colors": ["brown"], "season": ["winter"]}
	  ]
	}`
	twoItems = `{
	  "name": "Aziza",
	  "preferences": {"preferredStyles": ["classic"], "favoriteColors": ["black"]},
	  "items": [
	    {"file": "new/bag.png", "category": "bag", "subcategory": "tote", "colors": ["black"], "season": ["summer"]},
	    {"file": "new/coat.jpg", "category": "outerwear", "subcategory": "coat", "colors": ["beige"], "season": ["winter"]}
	  ]
	}`
)

func (w *world) threePhotos() {
	w.photo("min.png", "photos/shirt.png")
	w.photo("gps.jpg", "photos/jeans.jpg")
	w.photo("deep.png", "photos/shoes.png")
}

func (w *world) twoPhotos() {
	w.photo("gray.png", "new/bag.png")
	w.photo("orientation-6.jpg", "new/coat.jpg")
}

func manifest(t *testing.T, text string) demo.Manifest {
	t.Helper()
	m, err := demo.ParseManifest([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func (w *world) photos() *demo.Photos {
	w.t.Helper()
	p, err := demo.OpenPhotos(w.dir)
	if err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { _ = p.Close() })
	return p
}

func (w *world) seeder() *demo.Seeder {
	return demo.NewSeeder(demo.SeederConfig{
		Pool: w.pool, Images: w.images, Processor: imaging.NewProcessor(1), Log: slog.New(slog.NewJSONHandler(w.log, nil)),
	})
}

func (w *world) seed(account demo.Account, text string, reset bool) (demo.Outcome, error) {
	w.t.Helper()
	return w.seeder().Seed(context.Background(), account, manifest(w.t, text), w.photos(), reset)
}

var (
	demoAccount  = demo.Account{Email: "demo@lookly.uz", Password: "reviewer-pass-1"}
	otherAccount = demo.Account{Email: "demo@lookly.uz", Password: "another-pass-2"}
)

func (w *world) count(sql string, args ...any) int {
	w.t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (w *world) text(sql string, args ...any) string {
	w.t.Helper()
	var s string
	if err := w.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return s
}

// stored lists the files in the storage directory, sorted.
func (w *world) stored() []string {
	w.t.Helper()
	var keys []string
	if err := w.images.List(context.Background(), func(o storage.Object) error {
		keys = append(keys, o.Key)
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
	slices.Sort(keys)
	return keys
}

// imageKeys are the storage keys the image rows name, sorted.
func (w *world) imageKeys() []string {
	w.t.Helper()
	rows, err := w.pool.Query(context.Background(), `SELECT "storageKey", "displayKey", "thumbnailKey" FROM "WardrobeImage"`)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var master, display, thumb string
		if err := rows.Scan(&master, &display, &thumb); err != nil {
			w.t.Fatal(err)
		}
		keys = append(keys, master, display, thumb)
	}
	if err := rows.Err(); err != nil {
		w.t.Fatal(err)
	}
	slices.Sort(keys)
	return keys
}

// users is the account service of the server, to sign in with.
func (w *world) users() *accounts.Service {
	w.t.Helper()
	log := slog.New(slog.DiscardHandler)
	sessions := session.New(w.pool, session.Config{
		Tokens: auth.NewTokens([]byte(strings.Repeat("demo-jwt-", 5))), Keys: session.Keys{Active: bytes.Repeat([]byte{7}, 32)},
		AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour, Log: log,
	})
	return accounts.New(accounts.Config{
		Pool: w.pool, Sessions: sessions, Limiter: ratelimit.New(w.pool, []byte(strings.Repeat("demo-limit-", 4))),
		Consent: legal.NewService(w.pool), Hasher: auth.Bcrypt{}, Log: log,
	})
}

func (w *world) signIn(a demo.Account) (string, error) {
	w.t.Helper()
	user, _, err := w.users().Login(context.Background(), accounts.LoginInput{Email: a.Email, Password: a.Password}, accounts.Client{Type: session.Mobile})
	return user.ID, err
}

func TestADryRunChecksThePhotosAndWritesNothing(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	if err := demo.Check(context.Background(), imaging.NewProcessor(1), w.photos(), manifest(t, threeItems)); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM "User"`); n != 0 || len(w.stored()) != 0 {
		t.Errorf("%d users, files %v", n, w.stored())
	}
}

func TestApplyCreatesTheAccountWithItsWardrobe(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	out, err := w.seed(demoAccount, threeItems, false)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Created || out.Items != 3 || out.Removed != 0 || out.UserID == "" {
		t.Errorf("outcome %+v", out)
	}
	id := out.UserID

	// The user, as registration makes one: profile, preferences, consent.
	if got := w.text(`SELECT "email" || '|' || "name" FROM "User" WHERE "id" = $1`, id); got != "demo@lookly.uz|Dilnoza" {
		t.Errorf("user %q", got)
	}
	hash := w.text(`SELECT "passwordHash" FROM "User" WHERE "id" = $1`, id)
	if !auth.VerifyPassword(demoAccount.Password, hash) || auth.NeedsRehash(hash) {
		t.Errorf("the password hash does not verify at cost %d", auth.PasswordCost)
	}
	if n := w.count(`SELECT count(*) FROM "UserProfile" WHERE "userId" = $1`, id); n != 1 {
		t.Errorf("%d profiles", n)
	}
	prefs := w.text(`SELECT "preferredStyles" || '|' || "favoriteColors" || '|' || "dislikedStyles" || '|' || "dislikedColors" || '|' || "language"
	                   FROM "UserPreferences" WHERE "userId" = $1`, id)
	if prefs != `["smart_casual","minimal"]|["white","navy"]|[]|[]|uz` {
		t.Errorf("preferences %s", prefs)
	}
	if got := w.text(`SELECT "version" || '|' || "ageConfirmed"::text FROM "LegalConsent" WHERE "userId" = $1`, id); got != legal.Version+"|true" {
		t.Errorf("consent %s", got)
	}

	// The items, with the manifest's attributes, given by hand.
	rows, err := w.pool.Query(context.Background(), `
		SELECT "category", coalesce("subcategory", '-'), "colors", coalesce("pattern", '-'), coalesce("material", '-'), coalesce("sleeveLength", '-'),
		       coalesce("fit", '-'), coalesce("style", '-'), "season", coalesce("gender", '-'), coalesce("formality", '-'),
		       "confidences", "wasCorrected"::text, "correctionLog", "analysisProvider", "analysisModel", "analysisVersion",
		       ("analyzedAt" IS NOT NULL)::text, ("analysisRawConfidences" IS NULL)::text
		  FROM "WardrobeItem" WHERE "userId" = $1 ORDER BY "category"`, id)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		cols := make([]string, 19)
		ptrs := make([]any, len(cols))
		for i := range cols {
			ptrs[i] = &cols[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			t.Fatal(err)
		}
		got = append(got, strings.Join(cols, " "))
	}
	rows.Close()
	tail := ` {} false [] demo-seed manual demo-seed-1 true true`
	want := []string{
		`pants jeans ["navy","blue"] - - - - - ["autumn"] - -` + tail,
		`shirt tshirt ["white"] solid cotton short regular casual ["spring","summer"] unisex casual` + tail,
		`shoes - ["brown"] - - - - - ["winter"] - -` + tail,
	}
	if !slices.Equal(got, want) {
		t.Errorf("items\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	// Three files per photo, the variants an upload stores, named by the
	// rows; the image rows as an upload writes them.
	stored := w.stored()
	if len(stored) != 9 || !slices.Equal(stored, w.imageKeys()) {
		t.Errorf("files %v, rows name %v", stored, w.imageKeys())
	}
	for _, key := range stored {
		if !strings.HasPrefix(key, "users/"+id+"/") {
			t.Errorf("%s is not the user's", key)
		}
	}
	jeans := w.text(`SELECT img."storageKey" || '|' || img."displayKey" || '|' || img."thumbnailKey" || '|' || img."mimeType" || '|' || img."isPrimary"::text
	                        || '|' || img."width" || 'x' || img."height" || '|' || img."bytes" || '|' || img."sha256"
	                   FROM "WardrobeImage" img JOIN "WardrobeItem" i ON i."id" = img."wardrobeItemId" WHERE i."category" = 'pants'`)
	parts := strings.Split(jeans, "|")
	original, err := os.ReadFile(filepath.Join(w.dir, "photos", "jeans.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(parts[0], ".jpg") || !strings.HasSuffix(parts[1], "_display.webp") || !strings.HasSuffix(parts[2], "_thumb.webp") ||
		parts[3] != "image/jpeg" || parts[4] != "true" || parts[6] != fmt.Sprint(len(original)) || len(parts[7]) != 64 {
		t.Errorf("image row %s", jeans)
	}
	master, err := w.images.Get(context.Background(), parts[0])
	if err != nil {
		t.Fatal(err)
	}
	// The master went through the pipeline: re-encoded, its metadata (the
	// GPS position) gone.
	if bytes.Equal(master, original) || bytes.Contains(master, []byte("Exif")) {
		t.Error("the stored master is the photo as it was, metadata and all")
	}

	// The reviewer signs in with the password and sees the wardrobe.
	signedIn, err := w.signIn(demoAccount)
	if err != nil || signedIn != id {
		t.Fatalf("sign-in: %q, %v", signedIn, err)
	}
	me, err := w.users().Me(context.Background(), id)
	if err != nil || me.ConsentRequired {
		t.Errorf("me %+v, %v", me, err)
	}
	page, err := wardrobe.New(w.pool, w.images, slog.New(slog.DiscardHandler)).List(context.Background(), id, nil, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	var categories []string
	for _, item := range page.Items {
		categories = append(categories, item.Category)
		if len(item.Images) != 1 || item.Images[0].DisplayKey == nil || item.Images[0].ThumbnailKey == nil {
			t.Errorf("item %s images %+v", item.ID, item.Images)
		}
	}
	// Newest first: the manifest's last item on top.
	if !slices.Equal(categories, []string{"shoes", "pants", "shirt"}) {
		t.Errorf("wardrobe %v", categories)
	}
	if _, err := w.signIn(demo.Account{Email: demoAccount.Email, Password: "wrong-password"}); !unauthorized(err) {
		t.Errorf("a wrong password: %v", err)
	}
}

func TestASecondApplyWithoutResetRefusesAndChangesNothing(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	w.twoPhotos()
	first, err := w.seed(demoAccount, threeItems, false)
	if err != nil {
		t.Fatal(err)
	}
	before := w.text(`SELECT "name" || '|' || "passwordHash" || '|' || "updatedAt"::text FROM "User"`)
	files := w.stored()
	_, err = w.seed(otherAccount, twoItems, false)
	var exists *demo.WardrobeExistsError
	if !errors.As(err, &exists) || exists.Items != 3 {
		t.Fatalf("err %v", err)
	}
	if after := w.text(`SELECT "name" || '|' || "passwordHash" || '|' || "updatedAt"::text FROM "User"`); after != before {
		t.Errorf("the user changed: %s → %s", before, after)
	}
	if prefs := w.text(`SELECT "preferredStyles" FROM "UserPreferences"`); prefs != `["smart_casual","minimal"]` {
		t.Errorf("preferences %s", prefs)
	}
	if n := w.count(`SELECT count(*) FROM "WardrobeItem" WHERE "userId" = $1`, first.UserID); n != 3 || !slices.Equal(w.stored(), files) {
		t.Errorf("%d items, files %v (were %v)", n, w.stored(), files)
	}
}

func TestResetReplacesTheWardrobeAndRemovesTheEarlierFiles(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	w.twoPhotos()
	first, err := w.seed(demoAccount, threeItems, false)
	if err != nil {
		t.Fatal(err)
	}
	earlier := w.stored()
	// A reviewer is signed in with the first password.
	if _, err := w.signIn(demoAccount); err != nil {
		t.Fatal(err)
	}

	out, err := w.seed(otherAccount, twoItems, true)
	if err != nil {
		t.Fatal(err)
	}
	if out.Created || out.UserID != first.UserID || out.Removed != 3 || out.Items != 2 || out.SessionsEnded != 1 {
		t.Errorf("outcome %+v", out)
	}
	now := w.stored()
	if len(now) != 6 || !slices.Equal(now, w.imageKeys()) {
		t.Errorf("files %v, rows name %v", now, w.imageKeys())
	}
	for _, key := range earlier {
		if slices.Contains(now, key) {
			t.Errorf("an earlier file is still there: %s", key)
		}
	}
	if got := w.text(`SELECT string_agg("category", ',' ORDER BY "category") FROM "WardrobeItem"`); got != "bag,outerwear" {
		t.Errorf("items %s", got)
	}
	if got := w.text(`SELECT "name" FROM "User"`); got != "Aziza" {
		t.Errorf("name %q", got)
	}
	if prefs := w.text(`SELECT "preferredStyles" || '|' || "favoriteColors" || '|' || "language" FROM "UserPreferences"`); prefs != `["classic"]|["black"]|uz` {
		t.Errorf("preferences %s", prefs)
	}
	// One consent, one profile, one preferences row: nothing doubled.
	for _, table := range []string{"LegalConsent", "UserProfile", "UserPreferences", "User"} {
		if n := w.count(`SELECT count(*) FROM "` + table + `"`); n != 1 {
			t.Errorf("%d rows in %s", n, table)
		}
	}
	// The new password works, the old one does not, and the session made
	// with the old one has ended.
	if _, err := w.signIn(otherAccount); err != nil {
		t.Errorf("the new password: %v", err)
	}
	if _, err := w.signIn(demoAccount); !unauthorized(err) {
		t.Errorf("the old password: %v", err)
	}
	if n := w.count(`SELECT count(*) FROM "SessionFamily" WHERE "revokedAt" IS NOT NULL`); n != 1 {
		t.Errorf("%d families revoked", n)
	}

	// Again with the same password: the hash and the sessions stay.
	hash := w.text(`SELECT "passwordHash" FROM "User"`)
	again, err := w.seed(otherAccount, twoItems, true)
	if err != nil {
		t.Fatal(err)
	}
	if again.SessionsEnded != 0 || again.Removed != 2 || w.text(`SELECT "passwordHash" FROM "User"`) != hash {
		t.Errorf("outcome %+v; hash kept: %v", again, w.text(`SELECT "passwordHash" FROM "User"`) == hash)
	}
	if n := w.count(`SELECT count(*) FROM "SessionFamily" WHERE "revokedAt" IS NULL`); n != 1 {
		t.Errorf("%d live families", n)
	}
	if strings.Contains(w.log.String(), otherAccount.Password) || strings.Contains(w.log.String(), demoAccount.Password) {
		t.Errorf("the log has a password: %s", w.log.String())
	}
}

// An account that exists without a wardrobe (registered, or made by hand
// with an old hash and without its other rows) becomes the demo account:
// its id stays, the missing rows are made.
func TestAnExistingAccountWithoutItemsBecomesTheDemoAccount(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ('u_old', 'demo@lookly.uz', 'not-a-hash', now())`); err != nil {
		t.Fatal(err)
	}
	out, err := w.seed(demoAccount, threeItems, false)
	if err != nil {
		t.Fatal(err)
	}
	if out.Created || out.UserID != "u_old" || out.Items != 3 {
		t.Errorf("outcome %+v", out)
	}
	for _, table := range []string{"LegalConsent", "UserProfile", "UserPreferences"} {
		if n := w.count(`SELECT count(*) FROM "` + table + `" WHERE "userId" = 'u_old'`); n != 1 {
			t.Errorf("%d rows in %s", n, table)
		}
	}
	if id, err := w.signIn(demoAccount); err != nil || id != "u_old" {
		t.Errorf("sign-in %q, %v", id, err)
	}
}

func TestAPhotoThePipelineRefusesStopsTheRunWithItsNameAndLeavesNoFile(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ fixture, name, reason string }{
		{"tiny.png", "photos/tiny.png", "256"},
		{"garbage.bin", "photos/garbage.jpg", "not a readable picture"},
		{"picture.gif", "photos/animated.webp", "not a JPEG, PNG or WebP picture"},
		{"empty.bin", "photos/empty.png", "not a readable picture"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			w := newWorld(t)
			w.threePhotos()
			w.photo(c.fixture, c.name)
			text := strings.Replace(threeItems, `"photos/shoes.png"`, fmt.Sprintf("%q", c.name), 1)
			err := demo.Check(context.Background(), imaging.NewProcessor(1), w.photos(), manifest(t, text))
			if err == nil || !strings.HasPrefix(err.Error(), "photo "+c.name+": ") || !strings.Contains(err.Error(), c.reason) {
				t.Fatalf("check: %v", err)
			}
			// Seeding without the check: the items before it are made, the
			// refused one leaves nothing, and the error names it.
			_, err = w.seed(demoAccount, text, false)
			if err == nil || !strings.HasPrefix(err.Error(), "item 3 ("+c.name+"): ") || !strings.Contains(err.Error(), c.reason) {
				t.Fatalf("seed: %v", err)
			}
			if n := w.count(`SELECT count(*) FROM "WardrobeItem"`); n != 2 || len(w.stored()) != 6 || !slices.Equal(w.stored(), w.imageKeys()) {
				t.Errorf("%d items, files %v", n, w.stored())
			}
		})
	}
}

func TestPhotosAreReadFromInsideTheFolderOnlyAndWithinTheSizeLimit(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	check := func(text string) error {
		return demo.Check(context.Background(), imaging.NewProcessor(1), w.photos(), manifest(t, text))
	}
	if err := check(strings.Replace(threeItems, "photos/shoes.png", "photos/missing.png", 1)); err == nil || err.Error() != "photo photos/missing.png: not found" {
		t.Errorf("a missing photo: %v", err)
	}
	// A symbolic link out of the folder is not followed.
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, mustRead(t, filepath.Join("..", "..", "testdata", "images", "min.png")), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(w.dir, "photos", "link.png")); err != nil {
		t.Fatal(err)
	}
	if err := check(strings.Replace(threeItems, "photos/shoes.png", "photos/link.png", 1)); err == nil || !strings.HasPrefix(err.Error(), "photo photos/link.png: ") {
		t.Errorf("a link out of the folder: %v", err)
	}
	// A directory is no photo.
	if err := os.Mkdir(filepath.Join(w.dir, "photos", "dir.png"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := check(strings.Replace(threeItems, "photos/shoes.png", "photos/dir.png", 1)); err == nil || !strings.HasPrefix(err.Error(), "photo photos/dir.png: ") {
		t.Errorf("a directory: %v", err)
	}
	// 8 MB is the upload's limit: one byte more is refused before it is read.
	big := filepath.Join(w.dir, "photos", "big.png")
	if err := os.WriteFile(big, make([]byte, imaging.MaxBytes+1), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := check(strings.Replace(threeItems, "photos/shoes.png", "photos/big.png", 1)); err == nil || err.Error() != "photo photos/big.png: larger than 8 MB" {
		t.Errorf("a photo over 8 MB: %v", err)
	}
	if err := os.Truncate(big, imaging.MaxBytes); err != nil {
		t.Fatal(err)
	}
	if err := check(strings.Replace(threeItems, "photos/shoes.png", "photos/big.png", 1)); err == nil || strings.Contains(err.Error(), "8 MB") {
		t.Errorf("a photo of 8 MB is judged by the pipeline: %v", err)
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// An item whose rows cannot be written leaves none of its files.
func TestAnItemWhoseRowsCannotBeWrittenLeavesNoFile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.threePhotos()
	for _, sql := range []string{
		`CREATE FUNCTION refuse_images() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the disk of the database is full'; END $$`,
		`CREATE TRIGGER refuse_images BEFORE INSERT ON "WardrobeImage" FOR EACH ROW EXECUTE FUNCTION refuse_images()`,
	} {
		if _, err := w.pool.Exec(context.Background(), sql); err != nil {
			t.Fatal(err)
		}
	}
	_, err := w.seed(demoAccount, threeItems, false)
	if err == nil || !strings.HasPrefix(err.Error(), "item 1 (photos/shirt.png): ") || !strings.Contains(err.Error(), "the disk of the database is full") {
		t.Fatalf("err %v", err)
	}
	if n := w.count(`SELECT count(*) FROM "WardrobeItem"`); n != 0 || len(w.stored()) != 0 {
		t.Errorf("%d items, files %v", n, w.stored())
	}
	// The account itself was made (its transaction came first).
	if n := w.count(`SELECT count(*) FROM "User"`); n != 1 {
		t.Errorf("%d users", n)
	}
}

// unauthorized: the answer to a wrong email or password.
func unauthorized(err error) bool {
	var e *apierr.Error
	return errors.As(err, &e) && e.Code == apierr.Unauthorized
}
