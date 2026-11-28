//go:build integration

package outfits

import (
	"bytes"
	"context"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"lookly/internal/dbtest"
	"lookly/internal/engine"
	"lookly/internal/store"
	"lookly/migrations"
)

func ptr[T any](v T) *T { return &v }

// What the engine is given of the database, member by member. The HTTP
// tests compare whole answers, which many of these members do not change
// for a given wardrobe; here each is compared itself.
func TestWhatTheEngineIsGivenOfTheDatabase(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	now := time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)
	dbtest.SetClock(t, pool, now)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	user := func(id string) {
		exec(`INSERT INTO "User" ("id","email","passwordHash","createdAt","updatedAt") VALUES ($1,$2,'x',now(),now())`, id, id+"@test.local")
	}
	item := func(id, owner, category string) {
		exec(`INSERT INTO "WardrobeItem" ("id","userId","category","subcategory","colors","pattern","material","sleeveLength","fit","style",
			"season","gender","formality","confidences","correctionLog","createdAt","updatedAt")
			VALUES ($1,$2,$3,'sub-'||$1,'["white","navy"]','solid','cotton','short','regular','casual','["spring"]','unisex','casual','{}','[]',now(),now())`,
			id, owner, category)
	}
	outfit := func(id, owner string, items ...string) {
		exec(`INSERT INTO "Outfit" ("id","userId","reasonsJson","isSaved","createdAt","updatedAt") VALUES ($1,$2,'[]',false,now(),now())`, id, owner)
		for i, wardrobeItem := range items {
			exec(`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId","role","createdAt") VALUES ($1,$2,$3,'top',now() + $4 * interval '1 second')`,
				id+"-"+wardrobeItem, id, wardrobeItem, i)
		}
	}
	feedback := func(owner, outfitID, kind string, age time.Duration) {
		exec(`INSERT INTO "OutfitFeedback" ("id","userId","outfitId","feedback","createdAt") VALUES ($1,$2,$3,$4,$5)`,
			outfitID+"-"+kind+"-"+age.String(), owner, outfitID, kind, now.Add(-age))
	}

	user("u-me")
	user("u-other")
	for id, category := range map[string]string{
		"w-tee": "shirt", "w-shirt": "shirt", "w-jeans": "pants", "w-skirt": "pants", "w-dress": "dress", "w-coat": "outerwear",
		"w-boots": "shoes", "w-flats": "shoes", "w-bag": "bag", "w-scarf": "accessory", "w-odd": "swimwear",
	} {
		item(id, "u-me", category)
	}
	item("w-theirs", "u-other", "shirt")
	exec(`UPDATE "WardrobeItem" SET "subcategory" = NULL, "pattern" = NULL, "material" = NULL, "sleeveLength" = NULL, "fit" = NULL,
		"style" = NULL, "gender" = NULL, "formality" = NULL, "colors" = '[]', "season" = 'not json' WHERE "id" = 'w-odd'`)

	exec(`INSERT INTO "ColorProfile" ("id","userId","undertone","season","contrastLevel","recommendedColors","neutralColors","cautionColors",
		"analysisJson","confidence","undertoneConfidence","secondarySeason","secondaryConfidence","createdAt","updatedAt")
		VALUES ('cp-me','u-me','warm','autumn','medium','["olive","brown"]','["beige"]','["pink"]','{}',0.9,0.7,'spring',0.3,now(),now())`)
	exec(`INSERT INTO "UserProfile" ("id","userId","gender","preferredFit","colorProfileId","createdAt","updatedAt") VALUES ('p-me','u-me','female','oversized','cp-me',now(),now())`)
	exec(`INSERT INTO "UserPreferences" ("id","userId","preferredStyles","dislikedStyles","favoriteColors","dislikedColors","language","createdAt","updatedAt")
		VALUES ('pr-me','u-me','["classic","minimal"]','["sport"]','["blue"]','["orange","pink"]','uz',now(),now())`)

	// Feedback of each kind; outfits listed in another order than they sort.
	// Two tops (an outfit of before the composition rules): the first added counts in the key.
	outfit("o-rejected", "u-me", "w-bag", "w-shirt", "w-jeans", "w-boots", "w-scarf", "w-tee")
	outfit("o-z-disliked", "u-me", "w-dress", "w-flats")
	outfit("o-liked", "u-me", "w-tee", "w-skirt")
	outfit("o-saved", "u-me", "w-coat")
	outfit("o-accessories", "u-me", "w-bag", "w-scarf") // rejected: no composition to remember
	outfit("o-old", "u-me", "w-odd")
	outfit("o-theirs", "u-other", "w-theirs")
	feedback("u-me", "o-rejected", "rejected", time.Hour)
	feedback("u-me", "o-rejected", "rejected", 2*time.Hour)
	feedback("u-me", "o-z-disliked", "disliked", 30*24*time.Hour) // at the edge: counts
	feedback("u-me", "o-liked", "liked", time.Minute)
	feedback("u-me", "o-saved", "saved", time.Minute)
	feedback("u-me", "o-accessories", "rejected", time.Minute)
	feedback("u-me", "o-old", "rejected", 30*24*time.Hour+time.Second) // a second too old
	feedback("u-me", "o-old", "applauded", time.Minute)                // no kind we know
	feedback("u-other", "o-theirs", "rejected", time.Minute)
	// Rows the API never makes: feedback on another user's outfit, another
	// user's item in an outfit. Neither is read.
	item("w-mine-in-theirs", "u-me", "shirt")
	exec(`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId","role","createdAt") VALUES ('x-1','o-theirs','w-mine-in-theirs','top',now())`)
	feedback("u-me", "o-theirs", "liked", time.Minute)
	exec(`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId","role","createdAt") VALUES ('x-2','o-liked','w-theirs','top',now())`)

	var logs bytes.Buffer
	s := New(pool, nil, nil, nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	got, err := s.load(ctx, store.New(pool), "u-me")
	if err != nil {
		t.Fatal(err)
	}

	plain := func(id, category string) engine.Item {
		return engine.Item{
			ID: id, Category: category, Subcategory: ptr("sub-" + id), Colors: []string{"white", "navy"}, Pattern: ptr("solid"),
			Material: ptr("cotton"), SleeveLength: ptr("short"), Fit: ptr("regular"), Style: ptr("casual"), Season: []string{"spring"},
			Gender: ptr("unisex"), Formality: ptr("casual"),
		}
	}
	want := read{
		// By id.
		wardrobe: []engine.Item{
			plain("w-bag", "bag"), plain("w-boots", "shoes"), plain("w-coat", "outerwear"), plain("w-dress", "dress"),
			plain("w-flats", "shoes"), plain("w-jeans", "pants"), plain("w-mine-in-theirs", "shirt"),
			{ID: "w-odd", Category: "swimwear", Colors: []string{}, Season: []string{}},
			plain("w-scarf", "accessory"), plain("w-shirt", "shirt"), plain("w-skirt", "pants"), plain("w-tee", "shirt"),
		},
		profile: engine.Profile{
			Gender: ptr("female"), PreferredFit: ptr("oversized"), PreferredStyles: []string{"classic", "minimal"},
			DislikedStyles: []string{"sport"}, FavoriteColors: []string{"blue"}, DislikedColors: []string{"orange", "pink"},
		},
		colors: &engine.ColorProfile{
			Season: ptr("autumn"), SecondarySeason: ptr("spring"), Undertone: ptr("warm"), Confidence: ptr(0.9), UndertoneConfidence: ptr(0.7),
			SecondaryConfidence: ptr(0.3), RecommendedColors: []string{"olive", "brown"}, NeutralColors: []string{"beige"}, CautionColors: []string{"pink"},
		},
		feedback: engine.Feedback{
			RejectedItemIDs: []string{"w-bag", "w-boots", "w-dress", "w-flats", "w-jeans", "w-scarf", "w-shirt", "w-tee"},
			LikedItemIDs:    []string{"w-coat", "w-skirt", "w-tee"},
			// The main pieces only, whatever accessories went with them;
			// sorted: the dress's key ("t:-|…") before the shirt's ("t:w-shirt|…"),
			// although the shirt's outfit is read first.
			RejectedOutfitKeys: []string{
				engine.Key([]engine.KeyPiece{{ID: "w-dress", Slot: engine.Dress}, {ID: "w-flats", Slot: engine.Footwear}}),
				engine.Key([]engine.KeyPiece{{ID: "w-shirt", Slot: engine.Top}, {ID: "w-jeans", Slot: engine.Bottom}, {ID: "w-boots", Slot: engine.Footwear}}),
			},
		},
	}
	if keys := want.feedback.RejectedOutfitKeys; keys[0] >= keys[1] {
		t.Fatalf("the test's keys are not in the order it says: %q", keys)
	}
	for name, pair := range map[string][2]any{
		"the wardrobe": {got.wardrobe, want.wardrobe}, "the profile": {got.profile, want.profile},
		"the colour profile": {got.colors, want.colors}, "the feedback": {got.feedback, want.feedback},
	} {
		if !reflect.DeepEqual(pair[0], pair[1]) {
			t.Errorf("%s:\n got %+v\nwant %+v", name, pair[0], pair[1])
		}
	}

	// The stored list that is no list (w-odd's seasons) is logged by its row
	// and column, without its value; nothing else is.
	if text := logs.String(); strings.Count(text, "\n") != 1 || !strings.Contains(text, `"item":"w-odd"`) ||
		!strings.Contains(text, `"column":"season"`) || strings.Contains(text, "not json") {
		t.Errorf("the log: %s", text)
	}

	// A user with nothing: empty, not absent, and no colour profile made up.
	user("u-new")
	fresh, err := s.load(ctx, store.New(pool), "u-new")
	if err != nil {
		t.Fatal(err)
	}
	empty := read{
		wardrobe: []engine.Item{},
		profile:  engine.Profile{PreferredStyles: []string{}, DislikedStyles: []string{}, FavoriteColors: []string{}, DislikedColors: []string{}},
		feedback: engine.Feedback{RejectedItemIDs: []string{}, LikedItemIDs: []string{}, RejectedOutfitKeys: []string{}},
	}
	if !reflect.DeepEqual(fresh, empty) {
		t.Errorf("a new user:\n got %+v\nwant %+v", fresh, empty)
	}

	// Broken lists of the preferences and of the colour profile are logged by row and column too.
	logs.Reset()
	exec(`UPDATE "UserPreferences" SET "favoriteColors" = 'x' WHERE "userId" = 'u-me'`)
	exec(`UPDATE "ColorProfile" SET "cautionColors" = '{}' WHERE "id" = 'cp-me'`)
	if broken, err := s.load(ctx, store.New(pool), "u-me"); err != nil || len(broken.profile.FavoriteColors) != 0 || len(broken.colors.CautionColors) != 0 {
		t.Errorf("broken lists: %+v, %v", broken, err)
	}
	for _, line := range []string{`"preferences":"pr-me","column":"favoriteColors"`, `"colorProfile":"cp-me","column":"cautionColors"`, `"item":"w-odd","column":"season"`} {
		if !strings.Contains(logs.String(), line) {
			t.Errorf("the log lacks %s: %s", line, logs.String())
		}
	}
	if strings.Count(logs.String(), "\n") != 3 {
		t.Errorf("the log: %s", logs.String())
	}

	// A colour profile of another user that the profile points to is not used.
	exec(`UPDATE "ColorProfile" SET "userId" = 'u-other' WHERE "id" = 'cp-me'`)
	if again, err := s.load(ctx, store.New(pool), "u-me"); err != nil || again.colors != nil {
		t.Errorf("another user's colour profile: %+v, %v", again.colors, err)
	}
}

// What is read is bounded: of a wardrobe, twice what one may hold; of the
// feedback, the newest (outfit, kind) pairs.
func TestWhatIsReadIsBounded(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	dbtest.SetClock(t, pool, time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC))
	const more = wardrobeRows + 1
	if wardrobeRows != feedbackRows {
		t.Fatal("the test counts on one number for both bounds")
	}
	for _, sql := range []string{
		`INSERT INTO "User" ("id","email","passwordHash","createdAt","updatedAt") VALUES ('u-big','big@test.local','x',now(),now())`,
		// Items b-0001 … b-2001, an outfit of each, and a "liked" for each: the higher the number, the newer.
		`INSERT INTO "WardrobeItem" ("id","userId","category","colors","season","confidences","correctionLog","createdAt","updatedAt")
			SELECT 'b-' || lpad(n::text, 4, '0'), 'u-big', 'shirt', '[]', '[]', '{}', '[]', now(), now() FROM generate_series(1, $1) n`,
		`INSERT INTO "Outfit" ("id","userId","reasonsJson","isSaved","createdAt","updatedAt")
			SELECT 'o-' || lpad(n::text, 4, '0'), 'u-big', '[]', false, now(), now() FROM generate_series(1, $1) n`,
		`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId","role","createdAt")
			SELECT 'l-' || n, 'o-' || lpad(n::text, 4, '0'), 'b-' || lpad(n::text, 4, '0'), 'top', now() FROM generate_series(1, $1) n`,
		`INSERT INTO "OutfitFeedback" ("id","userId","outfitId","feedback","createdAt")
			SELECT 'f-' || n, 'u-big', 'o-' || lpad(n::text, 4, '0'), 'liked', atlas_now() - ($1 - n) * interval '1 second' FROM generate_series(1, $1) n`,
	} {
		args := []any{}
		if strings.Contains(sql, "$1") {
			args = append(args, more)
		}
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	s := New(pool, nil, nil, nil, slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)))
	got, err := s.load(ctx, store.New(pool), "u-big")
	if err != nil {
		t.Fatal(err)
	}
	// The wardrobe: the first by id.
	if n := len(got.wardrobe); n != wardrobeRows || got.wardrobe[0].ID != "b-0001" || got.wardrobe[n-1].ID != "b-2000" {
		t.Errorf("%d items read, from %s to %s", n, got.wardrobe[0].ID, got.wardrobe[n-1].ID)
	}
	// The feedback: all but the oldest (that of b-0001).
	liked := got.feedback.LikedItemIDs
	if n := len(liked); n != feedbackRows || liked[0] != "b-0002" || liked[n-1] != "b-2001" {
		t.Errorf("%d liked items, from %s to %s", n, liked[0], liked[n-1])
	}
}
