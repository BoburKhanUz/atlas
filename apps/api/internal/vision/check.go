package vision

import (
	"image"

	"lookly/internal/catalog"
	"lookly/internal/platform"
)

// The colour check: a model's primary colour is checked against the pixels
// of the centre of the photo, as the Next.js server does
// (apps/web/src/lib/ai/color-check.ts). Pixels only lower the colour's
// confidence: they never add, remove or replace a colour (backgrounds and
// light make them unreliable as a source).
const (
	// centreFraction of each side, around the centre, is looked at: the
	// garment is usually there.
	centreFraction = 0.6
	// CentreSampleSide is the side of the sample the centre is resized to.
	CentreSampleSide = 48
	// A primary colour whose family covers this share of the centre is
	// supported; below conflictShare it conflicts; between, it is weak.
	supportedShare = 0.15
	conflictShare  = 0.05
	// The colour confidence's cap when the support is weak, and when it
	// conflicts (below the clients' 0.40 "low" band: the user is asked to
	// check it).
	weakMaxConfidence     = 0.6
	conflictMaxConfidence = 0.35
)

// ColorFamilies are the colours a camera can plausibly report for a garment
// of a catalog colour (shades, shadow, highlights).
var ColorFamilies = map[string][]string{
	"white":      {"white", "cream", "ivory", "gray"},
	"black":      {"black", "gray", "navy"},
	"gray":       {"gray", "white", "black"},
	"navy":       {"navy", "blue", "black"},
	"blue":       {"blue", "navy", "light_blue", "teal"},
	"light_blue": {"light_blue", "blue", "white", "gray"},
	"beige":      {"beige", "tan", "cream", "khaki", "ivory"},
	"cream":      {"cream", "ivory", "white", "beige"},
	"ivory":      {"ivory", "cream", "white", "beige"},
	"tan":        {"tan", "beige", "khaki", "brown"},
	"khaki":      {"khaki", "beige", "tan", "olive"},
	"brown":      {"brown", "tan", "rust", "burgundy"},
	"olive":      {"olive", "khaki", "green"},
	"green":      {"green", "olive", "teal"},
	"teal":       {"teal", "green", "blue"},
	"red":        {"red", "burgundy", "rust", "pink"},
	"burgundy":   {"burgundy", "red", "brown", "purple"},
	"pink":       {"pink", "red", "purple"},
	"orange":     {"orange", "rust", "mustard"},
	"yellow":     {"yellow", "mustard"},
	"purple":     {"purple", "burgundy", "pink"},
	"rust":       {"rust", "orange", "brown", "red"},
	"mustard":    {"mustard", "yellow", "khaki"},
}

// The verdicts of the colour check.
const (
	ColorSupported = "supported"
	ColorWeak      = "weak"
	ColorConflict  = "conflict"
	ColorNone      = "no_color"
)

// ColorCheck is the verdict on a primary colour.
type ColorCheck struct {
	Verdict string
	// Support is the share of the centre the primary colour's family covers.
	Support float64
	// ConfidenceCap caps the colour's confidence; nil keeps it.
	ConfidenceCap *float64
}

// JudgeColor judges a primary colour ("" when the model named none) by the
// share of the centre each catalog colour covers.
func JudgeColor(primary string, shares map[string]float64) ColorCheck {
	if primary == "" {
		return ColorCheck{Verdict: ColorNone}
	}
	family, ok := ColorFamilies[primary]
	if !ok {
		family = []string{primary}
	}
	support := 0.0
	for _, id := range family {
		support += shares[id]
	}
	switch {
	case support >= supportedShare:
		return ColorCheck{Verdict: ColorSupported, Support: support}
	case support >= conflictShare:
		limit := weakMaxConfidence
		return ColorCheck{Verdict: ColorWeak, Support: support, ConfidenceCap: &limit}
	}
	limit := conflictMaxConfidence
	return ColorCheck{Verdict: ColorConflict, Support: support, ConfidenceCap: &limit}
}

// CentreOf is the centre of a picture the check looks at: six tenths of
// each side (at least one pixel), around the middle.
func CentreOf(width, height int) image.Rectangle {
	w := max(1, int(platform.RoundHalfUp(float64(width)*centreFraction)))
	h := max(1, int(platform.RoundHalfUp(float64(height)*centreFraction)))
	left, top := (width-w)/2, (height-h)/2
	return image.Rect(left, top, left+w, top+h)
}

// ColorShares names each pixel of a sample (R, G, B bytes) by the nearest
// catalog colour and returns the share of the pixels each name has.
func ColorShares(sample []byte) map[string]float64 {
	pixels := len(sample) / 3
	counts := map[string]int{}
	for i := 0; i+2 < len(sample); i += 3 {
		counts[catalog.Colors[nearestColor(int(sample[i]), int(sample[i+1]), int(sample[i+2]))]]++
	}
	shares := make(map[string]float64, len(counts))
	for id, n := range counts {
		shares[id] = float64(n) / float64(pixels)
	}
	return shares
}

// nearestColor is the catalog colour nearest to a pixel (the first of
// equally near ones).
func nearestColor(r, g, b int) int {
	best, bestDistance := 0, -1
	for i, c := range paletteRGB {
		dr, dg, db := r-c[0], g-c[1], b-c[2]
		if d := dr*dr + dg*dg + db*db; bestDistance < 0 || d < bestDistance {
			best, bestDistance = i, d
		}
	}
	return best
}

// paletteRGB are the catalog colours' values.
var paletteRGB = func() [][3]int {
	out := make([][3]int, len(palette))
	for i, c := range palette {
		out[i] = [3]int{int(c.r), int(c.g), int(c.b)}
	}
	return out
}()

// MinSharpness is the blur measure below which a photo is "unclear" without
// asking a model: models classify strongly blurred photos with confidence
// instead of answering "unclear". Calibrated by the Next.js server on real
// product photos (min 47.6) and the same photos blurred (max 14).
const MinSharpness = 20

// Canvas is a small picture: RGB bytes, row by row.
type Canvas struct {
	Width, Height int
	RGB           []byte
}

// Sharpness is the variance of the 4-neighbour Laplacian of the brightness
// over the canvas's inner pixels (0 for a canvas without any). The
// explicit conversions keep each step rounded as JavaScript rounds it.
func Sharpness(c Canvas) float64 {
	n := c.Width * c.Height
	luma := make([]float64, n)
	for i := range n {
		r, g, b := float64(c.RGB[i*3]), float64(c.RGB[i*3+1]), float64(c.RGB[i*3+2])
		luma[i] = float64(float64(0.299*r)+float64(0.587*g)) + float64(0.114*b)
	}
	var sum, squares float64
	count := 0
	for y := 1; y < c.Height-1; y++ {
		for x := 1; x < c.Width-1; x++ {
			i := y*c.Width + x
			v := float64(4*luma[i]) - luma[i-1] - luma[i+1] - luma[i-c.Width] - luma[i+c.Width]
			sum += v
			squares += float64(v * v)
			count++
		}
	}
	if count == 0 {
		return 0
	}
	mean := sum / float64(count)
	return squares/float64(count) - float64(mean*mean)
}
