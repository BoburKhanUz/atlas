package engine

import (
	"math"
	"testing"
)

// JavaScript's Math.round, number formatting and the seed's hash, on the
// values where they differ from Go's.
func TestJavaScriptArithmetic(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	for _, c := range g.Numbers.Round {
		if got := jsRound(c.Value); got != c.Rounded {
			t.Errorf("round(%v): %v, want %v", c.Value, got, c.Rounded)
		}
	}
	for _, c := range g.Numbers.Seeds {
		if got := jsNumberString(c.Seed); got != c.Text {
			t.Errorf("String(%v): %q, want %q", c.Seed, got, c.Text)
		}
		if got := seedHash(c.Seed); got != c.Hash {
			t.Errorf("seedHash(%v): %d, want %d", c.Seed, got, c.Hash)
		}
	}
	// Not in a JSON file: the values JSON cannot carry.
	for value, want := range map[float64]string{math.Inf(1): "Infinity", math.Inf(-1): "-Infinity", math.Copysign(0, -1): "0"} {
		if got := jsNumberString(value); got != want {
			t.Errorf("String(%v): %q, want %q", value, got, want)
		}
	}
	if got := jsNumberString(math.NaN()); got != "NaN" {
		t.Errorf("String(NaN): %q", got)
	}
}

// JavaScript orders strings by UTF-16 code units: a character outside the
// basic plane sorts before U+E000..U+FFFF there, after them by code point.
func TestStringsCompareAsInJavaScript(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"a", "b", -1}, {"b", "a", 1}, {"a", "a", 0}, {"a", "ab", -1}, {"", "a", -1},
		{"Z", "a", -1}, {"\U0001F600", "￿", -1}, {"￿", "\U0001F600", 1}, {"é", "z", 1},
	} {
		if got := compareJS(c.a, c.b); got != c.want {
			t.Errorf("compare(%q, %q): %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
