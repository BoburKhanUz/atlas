package demo_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"lookly/internal/demo"
)

// exampleFile is the example manifest operators copy (deploy/demo).
var exampleFile = filepath.Join("..", "..", "..", "..", "deploy", "demo", "manifest.example.json")

// example is the example manifest as a JSON value, a fresh copy each call.
func example(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(exampleFile)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// firstItem is the example's first item, a fresh copy.
func firstItem(t *testing.T) map[string]any {
	t.Helper()
	return example(t)["items"].([]any)[0].(map[string]any)
}

func with(m map[string]any, key string, value any) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		out[k] = v
	}
	if value == nil {
		delete(out, key)
	} else {
		out[key] = value
	}
	return out
}

func items(list ...map[string]any) []any {
	out := make([]any, len(list))
	for i, item := range list {
		out[i] = item
	}
	return out
}

// problems parses a manifest given as a JSON value (or as raw text) and
// returns its problems, none when it is valid.
func problems(t *testing.T, manifest any) []string {
	t.Helper()
	raw, ok := manifest.([]byte)
	if !ok {
		var err error
		if raw, err = json.Marshal(manifest); err != nil {
			t.Fatal(err)
		}
	}
	_, err := demo.ParseManifest(raw)
	if err == nil {
		return nil
	}
	var invalid *demo.ManifestError
	if !errors.As(err, &invalid) {
		t.Fatalf("not a ManifestError: %v", err)
	}
	if len(invalid.Problems) == 0 {
		t.Fatal("a ManifestError without problems")
	}
	return invalid.Problems
}

func parse(t *testing.T, manifest any) demo.Manifest {
	t.Helper()
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	m, err := demo.ParseManifest(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return m
}

func firstHasPrefix(t *testing.T, got []string, prefix string) {
	t.Helper()
	if len(got) == 0 || !strings.HasPrefix(got[0], prefix) {
		t.Errorf("problems %q: the first does not start with %q", got, prefix)
	}
}

func firstContains(t *testing.T, got []string, part string) {
	t.Helper()
	if len(got) == 0 || !strings.Contains(got[0], part) {
		t.Errorf("problems %q: the first does not contain %q", got, part)
	}
}

func TestTheExampleManifestIsValidAndCoversTopsBottomsAndShoes(t *testing.T) {
	t.Parallel()
	m := parse(t, example(t))
	categories := map[string]bool{}
	for _, item := range m.Items {
		categories[item.Category] = true
		if len(item.Colors) == 0 || len(item.Season) == 0 {
			t.Errorf("item %s: colours %v, seasons %v", item.File, item.Colors, item.Season)
		}
	}
	want := map[string]bool{"shirt": true, "pants": true, "shoes": true, "outerwear": true, "bag": true}
	if fmt.Sprint(categories) != fmt.Sprint(want) {
		t.Errorf("categories %v", categories)
	}
	if m.Name != "Dilnoza" || !slices.Equal(m.Preferences.PreferredStyles, []string{"smart_casual", "minimal"}) ||
		!slices.Equal(m.Preferences.FavoriteColors, []string{"white", "navy", "beige"}) {
		t.Errorf("name %q, preferences %+v", m.Name, m.Preferences)
	}
	first := m.Items[0]
	if first.File != "photos/white-tshirt.jpg" || first.Category != "shirt" || *first.Subcategory != "tshirt" ||
		!slices.Equal(first.Colors, []string{"white"}) || *first.Pattern != "solid" || *first.Material != "cotton" ||
		*first.SleeveLength != "short" || *first.Fit != "regular" || *first.Style != "casual" ||
		!slices.Equal(first.Season, []string{"spring", "summer"}) || *first.Gender != "unisex" || *first.Formality != "casual" {
		t.Errorf("first item %+v", first)
	}
	// Counts per category, in the order the manifest names them first.
	if got := m.Summary(); got != "8 items (shirt 2, pants 2, shoes 2, outerwear 1, bag 1)" {
		t.Errorf("summary %q", got)
	}
}

func TestOmittedAttributesAreNone(t *testing.T) {
	t.Parallel()
	m := parse(t, map[string]any{"name": "A", "items": items(map[string]any{"file": "a.jpg", "category": "shoes", "colors": []string{"white"}, "season": []string{"summer"}})})
	item := m.Items[0]
	for name, v := range map[string]*string{
		"subcategory": item.Subcategory, "pattern": item.Pattern, "material": item.Material, "sleeveLength": item.SleeveLength,
		"fit": item.Fit, "style": item.Style, "gender": item.Gender, "formality": item.Formality,
	} {
		if v != nil {
			t.Errorf("%s = %q, want none", name, *v)
		}
	}
	if len(m.Preferences.PreferredStyles) != 0 || len(m.Preferences.FavoriteColors) != 0 {
		t.Errorf("preferences %+v", m.Preferences)
	}
	if got := m.Summary(); got != "1 item (shoes 1)" {
		t.Errorf("summary %q", got)
	}
	// null is the same as leaving it out.
	withNull := parse(t, map[string]any{"name": "A", "items": items(map[string]any{
		"file": "a.jpg", "category": "shoes", "subcategory": nil, "formality": nil, "colors": []string{"white"}, "season": []string{"summer"},
	})})
	if withNull.Items[0].Subcategory != nil || withNull.Items[0].Formality != nil {
		t.Errorf("null attributes: %+v", withNull.Items[0])
	}
}

func TestValuesOutsideTheCatalogASubcategoryOfAnotherCategoryAndUnknownFieldsAreRefused(t *testing.T) {
	t.Parallel()
	ex, item := example(t), firstItem(t)
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "colors", []string{"neon"})))), "items.0.colors.0: ")
	if got := problems(t, with(ex, "items", items(with(item, "subcategory", "jeans")))); !slices.Equal(got, []string{"items.0.subcategory: jeans is not a shirt subcategory"}) {
		t.Errorf("subcategory of another category: %q", got)
	}
	if got := problems(t, with(ex, "items", items(with(item, "price", 10)))); !slices.Equal(got, []string{`items.0: unknown field "price"`}) {
		t.Errorf("unknown member: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "colors", []string{})))), "items.0.colors: ")
}

func TestEveryAttributeIsACatalogID(t *testing.T) {
	t.Parallel()
	ex, item := example(t), firstItem(t)
	for field, value := range map[string]any{
		"category": "hat", "subcategory": "toga", "pattern": "dots", "material": "plastic", "sleeveLength": "none",
		"fit": "baggy", "style": "goth", "gender": "any", "formality": "sloppy",
	} {
		got := problems(t, with(ex, "items", items(with(item, field, value))))
		if len(got) != 1 || !strings.HasPrefix(got[0], "items.0."+field+": unknown ") || !strings.Contains(got[0], fmt.Sprintf("%q", value)) {
			t.Errorf("%s %q: %q", field, value, got)
		}
	}
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "season", []string{"summer", "monsoon"})))), "items.0.season.1: ")
	// The wrong type and a missing value.
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "colors", "white")))), "items.0.colors: must be a list")
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "category", 5)))), "items.0.category: must be a string")
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "category", nil)))), "items.0.category: required")
	if got := problems(t, with(ex, "items", items(with(item, "category", nil), with(item, "file", "photos/b.jpg")))); len(got) != 1 {
		t.Errorf("a missing category also judged the subcategory: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "season", nil)))), "items.0.season: required")
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "file", nil)))), "items.0.file: required")
}

func TestListLimits(t *testing.T) {
	t.Parallel()
	ex, item := example(t), firstItem(t)
	if got := problems(t, with(ex, "items", items(with(item, "colors", []string{"white", "black", "beige", "gray", "navy"})))); got != nil {
		t.Errorf("5 colours: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "colors", []string{"white", "black", "beige", "gray", "navy", "blue"})))), "items.0.colors: at most 5")
	if got := problems(t, with(ex, "items", items(with(item, "season", []string{"spring", "summer", "autumn", "winter"})))); got != nil {
		t.Errorf("4 seasons: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "season", []string{"spring", "summer", "autumn", "winter", "spring"})))), "items.0.season: at most 4")
	firstHasPrefix(t, problems(t, with(ex, "items", items(with(item, "season", []string{})))), "items.0.season: at least 1")
}

func TestPhotosAreImagesInsideTheManifestFolderEachOnce(t *testing.T) {
	t.Parallel()
	ex, item := example(t), firstItem(t)
	for _, file := range []string{"a.gif", "a", "a.jpg.txt", "", "photos/"} {
		firstContains(t, problems(t, with(ex, "items", items(with(item, "file", file)))), "photo must be .jpg, .jpeg, .png or .webp")
	}
	for _, file := range []string{"A.JPG", "b.jpeg", "c.png", "d.WebP", "sub/dir/e.jpg", "./f.jpg"} {
		if got := problems(t, with(ex, "items", items(with(item, "file", file)))); got != nil {
			t.Errorf("%q refused: %q", file, got)
		}
	}
	for _, file := range []string{"../secret.jpg", "/etc/a.jpg", "photos/../../a.jpg", "photos/../a.jpg", `photos\..\a.jpg`, `\a.jpg`, "..", "a\x00.jpg"} {
		got := problems(t, with(ex, "items", items(with(item, "file", file))))
		if len(got) == 0 || !strings.HasPrefix(got[0], "items.0.file: ") || !strings.Contains(strings.Join(got, "\n"), "inside the manifest folder") {
			t.Errorf("%q: %q", file, got)
		}
	}
	if got := problems(t, with(ex, "items", items(item, item))); !slices.Equal(got, []string{"items.1.file: the same photo twice"}) {
		t.Errorf("the same photo twice: %q", got)
	}
	// The same file under another spelling is the same photo.
	if got := problems(t, with(ex, "items", items(item, with(item, "file", "./photos//white-tshirt.jpg")))); !slices.Equal(got, []string{"items.1.file: the same photo twice"}) {
		t.Errorf("the same photo, spelled differently: %q", got)
	}
}

func TestItemCountLimits(t *testing.T) {
	t.Parallel()
	ex, item := example(t), firstItem(t)
	many := func(n int) []any {
		list := make([]any, n)
		for i := range list {
			list[i] = with(item, "file", fmt.Sprintf("photos/%02d.jpg", i))
		}
		return list
	}
	if m := parse(t, with(ex, "items", many(60))); len(m.Items) != 60 {
		t.Errorf("60 items: %d", len(m.Items))
	}
	if got := problems(t, with(ex, "items", many(61))); !slices.Equal(got, []string{"items: at most 60 items"}) {
		t.Errorf("61 items: %q", got)
	}
	if got := problems(t, with(ex, "items", many(0))); !slices.Equal(got, []string{"items: at least 1 item"}) {
		t.Errorf("no items: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "items", nil)), "items: required")
	firstHasPrefix(t, problems(t, with(ex, "items", "photos")), "items: must be a list")
	firstHasPrefix(t, problems(t, with(ex, "items", []any{"photos/a.jpg"})), "items.0: must be an object")
}

func TestTheNameIsOneToSixtyCharactersAfterTrimming(t *testing.T) {
	t.Parallel()
	ex := example(t)
	sixty := strings.Repeat("ш", 60) // two bytes each: characters, not bytes, are counted
	if m := parse(t, with(ex, "name", " \t"+sixty+" ")); m.Name != sixty {
		t.Errorf("60 characters with white space around: %q", m.Name)
	}
	for _, name := range []any{sixty + "ш", "", "   ", strings.Repeat("😀", 31)} {
		firstHasPrefix(t, problems(t, with(ex, "name", name)), "name: must be 1 to 60 characters")
	}
	firstHasPrefix(t, problems(t, with(ex, "name", "Dil\x00noza")), "name: ")
	firstHasPrefix(t, problems(t, with(ex, "name", nil)), "name: required")
	firstHasPrefix(t, problems(t, with(ex, "name", 7)), "name: must be a string")
}

func TestPreferencesLimits(t *testing.T) {
	t.Parallel()
	ex := example(t)
	prefs := func(styles, colors []string) map[string]any {
		return map[string]any{"preferredStyles": styles, "favoriteColors": colors}
	}
	five := []string{"casual", "smart_casual", "formal", "sporty", "minimal"}
	eight := []string{"white", "black", "beige", "gray", "navy", "blue", "light_blue", "green"}
	if m := parse(t, with(ex, "preferences", prefs(five, eight))); len(m.Preferences.PreferredStyles) != 5 || len(m.Preferences.FavoriteColors) != 8 {
		t.Errorf("5 styles, 8 colours: %+v", m.Preferences)
	}
	if got := problems(t, with(ex, "preferences", prefs(append(five, "classic"), eight))); !slices.Equal(got, []string{"preferences.preferredStyles: at most 5 styles"}) {
		t.Errorf("6 styles: %q", got)
	}
	if got := problems(t, with(ex, "preferences", prefs(five, append(eight, "olive")))); !slices.Equal(got, []string{"preferences.favoriteColors: at most 8 colours"}) {
		t.Errorf("9 colours: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "preferences", prefs([]string{"goth"}, nil))), `preferences.preferredStyles.0: unknown style "goth"`)
	firstHasPrefix(t, problems(t, with(ex, "preferences", prefs(nil, []string{"white", "neon"}))), `preferences.favoriteColors.1: unknown colour "neon"`)
	if got := problems(t, with(ex, "preferences", map[string]any{"dislikedStyles": []string{}})); !slices.Equal(got, []string{`preferences: unknown field "dislikedStyles"`}) {
		t.Errorf("unknown preference: %q", got)
	}
	firstHasPrefix(t, problems(t, with(ex, "preferences", []string{})), "preferences: must be an object")
	if m := parse(t, with(ex, "preferences", map[string]any{})); len(m.Preferences.PreferredStyles) != 0 || len(m.Preferences.FavoriteColors) != 0 {
		t.Errorf("empty preferences: %+v", m.Preferences)
	}
}

func TestTheManifestItselfIsAStrictObject(t *testing.T) {
	t.Parallel()
	ex := example(t)
	if got := problems(t, with(ex, "owner", "me")); !slices.Equal(got, []string{`(manifest): unknown field "owner"`}) {
		t.Errorf("unknown member: %q", got)
	}
	// Member names are matched exactly (Go's decoder would match "Name").
	firstHasPrefix(t, problems(t, map[string]any{"Name": "A", "name": "A", "items": ex["items"]}), `(manifest): unknown field "Name"`)
	firstHasPrefix(t, problems(t, []byte(`[]`)), "(manifest): must be an object")
	firstHasPrefix(t, problems(t, []byte(`{"name": "A",`)), "(manifest): not valid JSON")
	firstHasPrefix(t, problems(t, []byte(``)), "(manifest): not valid JSON")
	// Problems are reported together, in the manifest's order.
	got := problems(t, map[string]any{"name": "", "items": items(map[string]any{"file": "a.gif", "category": "hat", "colors": []string{}, "season": []string{"summer"}})})
	want := []string{
		"name: must be 1 to 60 characters after trimming",
		"items.0.file: photo must be .jpg, .jpeg, .png or .webp",
		`items.0.category: unknown category "hat"`,
		"items.0.colors: at least 1 colour",
	}
	if !slices.Equal(got, want) {
		t.Errorf("problems\n%q\nwant\n%q", got, want)
	}
	var invalid *demo.ManifestError
	if _, err := demo.ParseManifest([]byte(`{}`)); !errors.As(err, &invalid) || err.Error() != "name: required\nitems: required" {
		t.Errorf("the error's text: %v", err)
	}
}

func env(vars map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := vars[k]
		return v, ok
	}
}

func TestCredentialsComeFromTheEnvironmentAndAreChecked(t *testing.T) {
	t.Parallel()
	a, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": " Demo@Atlas.UZ ", "DEMO_PASSWORD": "12345678"}))
	if err != nil || a.Email != "demo@atlas.uz" || a.Password != "12345678" {
		t.Errorf("account %q, err %v", a.Email, err)
	}
	// The password as it is: white space is part of it.
	if a, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": " 1234567"})); err != nil || a.Password != " 1234567" {
		t.Errorf("a password with a space: err %v", err)
	}
	for name, vars := range map[string]map[string]string{
		"DEMO_EMAIL":    {"DEMO_PASSWORD": "12345678"},
		"DEMO_EMAIL ":   {"DEMO_EMAIL": "demo@atlas", "DEMO_PASSWORD": "12345678"},
		"DEMO_EMAIL  ":  {"DEMO_EMAIL": "", "DEMO_PASSWORD": "12345678"},
		"DEMO_PASSWORD": {"DEMO_EMAIL": "demo@atlas.uz"},
		// Seven characters; then 37 characters of two bytes each: 74
		// bytes, more than bcrypt reads.
		"DEMO_PASSWORD ":  {"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": "short12"},
		"DEMO_PASSWORD  ": {"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": strings.Repeat("ш", 37)},
	} {
		_, err := demo.Credentials(env(vars))
		if err == nil || !strings.HasPrefix(err.Error(), strings.TrimSpace(name)+" ") {
			t.Errorf("%v: err %v", vars, err)
		}
		if p := vars["DEMO_PASSWORD"]; err != nil && p != "" && strings.Contains(err.Error(), p) {
			t.Errorf("the error quotes the password: %v", err)
		}
	}
	// Seventy-two bytes is the most bcrypt reads: taken; four characters
	// outside the basic plane count eight, as at registration.
	if _, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": strings.Repeat("ш", 36)})); err != nil {
		t.Errorf("72 bytes: %v", err)
	}
	if _, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": strings.Repeat("😀", 4)})); err != nil {
		t.Errorf("4 characters outside the basic plane: %v", err)
	}
	if _, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": strings.Repeat("😀", 3) + "a"})); err == nil {
		t.Error("7 units taken")
	}
}

func TestAnAccountNeverPrintsItsPassword(t *testing.T) {
	t.Parallel()
	a, err := demo.Credentials(env(map[string]string{"DEMO_EMAIL": "demo@atlas.uz", "DEMO_PASSWORD": "never-print-me"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"%v", "%+v", "%#v", "%s"} {
		if out := fmt.Sprintf(format, a); strings.Contains(out, "never-print-me") || !strings.Contains(out, "demo@atlas.uz") {
			t.Errorf("%s: %s", format, out)
		}
	}
	if out := fmt.Sprintf("%v", []demo.Account{a}); strings.Contains(out, "never-print-me") {
		t.Errorf("in a list: %s", out)
	}
}
