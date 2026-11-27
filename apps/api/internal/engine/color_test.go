package engine

import (
	"testing"

	"lookly/internal/catalog"
)

// Every catalog colour has the metadata the TypeScript engine derives from
// its hex value, to the bit; an unknown colour has none.
func TestColourMetadataIsTheTypeScriptEngines(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	if len(g.Colors.Meta) != len(catalog.Colors)+2 {
		t.Fatalf("%d colours in the golden file, %d in the catalog", len(g.Colors.Meta)-2, len(catalog.Colors))
	}
	for _, c := range g.Colors.Meta {
		got, ok := metaOf(c.ID)
		if c.Meta == nil {
			if ok {
				t.Errorf("%q: metadata for a colour that is not one", c.ID)
			}
			continue
		}
		want := colorMeta{hue: c.Meta.Hue, saturation: c.Meta.Saturation, lightness: c.Meta.Lightness, temperature: c.Meta.Temperature, neutral: c.Meta.IsNeutral}
		if !ok || got != want {
			t.Errorf("%s: %+v, want %+v", c.ID, got, want)
		}
	}
}

func TestColourPairScoresAreTheTypeScriptEngines(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	ids := append(append([]string{}, catalog.Colors...), "no_such_colour")
	if len(g.Colors.Pairs) != len(ids) {
		t.Fatalf("%d rows for %d colours", len(g.Colors.Pairs), len(ids))
	}
	for i, a := range ids {
		for j, b := range ids {
			if got := pairScore(a, b); got != g.Colors.Pairs[i][j] {
				t.Errorf("%s with %s: %v, want %v", a, b, got, g.Colors.Pairs[i][j])
			}
		}
	}
}

func TestOccasionColourScoresAndContrastAreTheTypeScriptEngines(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	for _, c := range g.Colors.Occasion {
		if got := occasionColorScore(c.Sets, c.Occasion); got != c.Score {
			t.Errorf("%v for %s: %v, want %v", c.Sets, c.Occasion, got, c.Score)
		}
	}
	for _, c := range g.Colors.Contrast {
		if got := contrastOf(c.Sets); got != c.Level {
			t.Errorf("%v: contrast %s, want %s", c.Sets, got, c.Level)
		}
	}
	// An occasion the catalog does not know scores as "other".
	if got := occasionColorScore([][]string{{"white"}}, "no_such_occasion"); got != 70 {
		t.Errorf("an unknown occasion: %v", got)
	}
}
