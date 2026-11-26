package catalog_test

import (
	"regexp"
	"slices"
	"testing"

	"lookly/internal/catalog"
)

// The copy is whole: every vocabulary is there, ids are unique within it,
// labels are set, colours have a reference value, and every category has
// its subcategories (the web app checks that the copy equals the source).
func TestTheEmbeddedCatalogIsWhole(t *testing.T) {
	t.Parallel()
	hex := regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	for name, list := range map[string][]catalog.Entry{
		"categories": catalog.CategoryEntries, "patterns": catalog.PatternEntries, "materials": catalog.MaterialEntries,
		"styles": catalog.StyleEntries, "sleeve lengths": catalog.SleeveLengthEntries, "fits": catalog.FitEntries,
		"seasons": catalog.SeasonEntries, "formalities": catalog.FormalityEntries, "genders": catalog.GenderEntries,
		"occasions": catalog.OccasionEntries,
	} {
		if len(list) < 3 {
			t.Errorf("%s: %d entries", name, len(list))
		}
		seen := map[string]bool{}
		for _, e := range list {
			if e.ID == "" || e.Label == "" || seen[e.ID] {
				t.Errorf("%s: entry %+v is empty or repeated", name, e)
			}
			seen[e.ID] = true
		}
	}
	if len(catalog.ColorEntries) != len(catalog.Colors) || len(catalog.Colors) < 20 {
		t.Errorf("%d colours", len(catalog.Colors))
	}
	for _, c := range catalog.ColorEntries {
		if !hex.MatchString(c.Hex) || c.Label == "" {
			t.Errorf("colour %+v", c)
		}
	}
	all := 0
	for _, category := range catalog.Categories {
		subs := catalog.Subcategories(category)
		if len(subs) == 0 {
			t.Errorf("category %s has no subcategories", category)
		}
		for _, s := range subs {
			if !catalog.SubcategoryOf(category, s.ID) {
				t.Errorf("%s/%s", category, s.ID)
			}
		}
		all += len(subs)
	}
	if all != len(catalog.AllSubcategories) || catalog.SubcategoryOf("shirt", "jeans") || catalog.SubcategoryOf("nope", "jeans") || catalog.Subcategories("nope") != nil {
		t.Error("subcategories do not belong to their category alone")
	}
	if !slices.Equal(catalog.Fits, []string{"slim", "regular", "relaxed", "oversized"}) {
		t.Errorf("fits %v", catalog.Fits)
	}
}
