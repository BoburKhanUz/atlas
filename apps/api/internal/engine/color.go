package engine

import (
	"math"
	"strconv"
	"sync"

	"lookly/internal/catalog"
)

// Colour theory (apps/web/src/lib/ai/color-theory.ts): heuristics over the
// catalog colours' hue, saturation and lightness. All scores are 0–100.

// colorMeta is what the rules know of a catalog colour.
type colorMeta struct {
	hue         float64 // 0–360, rounded
	saturation  float64 // 0–1
	lightness   float64 // 0–1
	temperature string  // warm | cool | neutral
	neutral     bool
}

var colorMetas = sync.OnceValue(func() map[string]colorMeta {
	metas := make(map[string]colorMeta, len(catalog.ColorEntries))
	for _, c := range catalog.ColorEntries {
		h, s, l := hexToHSL(c.Hex)
		metas[c.ID] = colorMeta{hue: jsRound(h), saturation: s, lightness: l, temperature: temperatureOf(h, s), neutral: s < 0.12}
	}
	return metas
})

// metaOf is a catalog colour's metadata; false for anything else.
func metaOf(id string) (colorMeta, bool) {
	m, ok := colorMetas()[id]
	return m, ok
}

func hexToHSL(hex string) (h, s, l float64) {
	channel := func(from int) float64 {
		v, _ := strconv.ParseUint(hex[from:from+2], 16, 8)
		return float64(v) / 255
	}
	r, g, b := channel(1), channel(3), channel(5)
	hi, lo := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	l = (hi + lo) / 2
	if hi == lo {
		return 0, 0, l
	}
	d := hi - lo
	if l > 0.5 {
		s = d / (2 - hi - lo)
	} else {
		s = d / (hi + lo)
	}
	switch hi {
	case r:
		wrap := 0.0
		if g < b {
			wrap = 6
		}
		h = ((g-b)/d + wrap) * 60
	case g:
		h = ((b-r)/d + 2) * 60
	default:
		h = ((r-g)/d + 4) * 60
	}
	return h, s, l
}

func temperatureOf(hue, saturation float64) string {
	switch {
	case saturation < 0.12:
		return "neutral"
	case hue >= 0 && hue < 90:
		return "warm"
	}
	return "cool"
}

// pairScore is the harmony of two colours.
func pairScore(aID, bID string) float64 {
	a, okA := metaOf(aID)
	b, okB := metaOf(bID)
	switch {
	case !okA || !okB:
		return 50
	case aID == bID:
		return 92 // monochromatic
	case a.neutral && b.neutral:
		return 90
	case a.neutral != b.neutral:
		return 86 // a neutral base carries the colour
	}
	diff := math.Abs(a.hue - b.hue)
	distance := math.Min(diff, 360-diff)
	sameTemperature := a.temperature == b.temperature
	switch {
	case distance <= 30 && sameTemperature:
		return 88 // analogous
	case sameTemperature && distance <= 90:
		return 80
	case distance >= 150 && distance <= 210: // complementary
		if (a.saturation+b.saturation)/2 < 0.4 {
			return 75
		}
		return 58
	case !sameTemperature && distance > 90:
		return 42
	}
	return 65
}

// contrastOf is how far apart the lightest and the darkest colour are.
func contrastOf(sets [][]string) string {
	lo, hi, n := math.Inf(1), math.Inf(-1), 0
	for _, set := range sets {
		for _, c := range set {
			if m, ok := metaOf(c); ok {
				lo, hi = math.Min(lo, m.lightness), math.Max(hi, m.lightness)
				n++
			}
		}
	}
	if n < 2 {
		return "low"
	}
	switch diff := hi - lo; {
	case diff > 0.6:
		return "high"
	case diff > 0.3:
		return "medium"
	}
	return "low"
}

// occasionColorScore is how well a palette suits an occasion.
func occasionColorScore(sets [][]string, occasion string) float64 {
	warm, allNeutral, bright, n := false, true, false, 0
	for _, set := range sets {
		for _, id := range set {
			n++
			m, ok := metaOf(id)
			temperature := "neutral" // an unknown colour counts as neutral
			if ok {
				temperature = m.temperature
				bright = bright || m.saturation > 0.5
			}
			warm = warm || temperature == "warm"
			allNeutral = allNeutral && temperature == "neutral"
		}
	}
	if n == 0 {
		return 50
	}
	switch occasion {
	case "wedding":
		switch {
		case allNeutral:
			return 88
		case warm && !bright:
			return 90
		case bright:
			return 45
		}
		return 70
	case "work":
		switch {
		case allNeutral:
			return 92
		case !bright:
			return 80
		}
		return 50
	case "date":
		switch {
		case warm:
			return 88
		case allNeutral:
			return 75
		}
		return 65
	case "travel":
		if allNeutral {
			return 88
		}
		return 70
	case "casual":
		return 80
	}
	return 70
}
