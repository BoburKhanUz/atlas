// Package vision is garment analysis: what a photo of a garment shows. Until
// the real providers arrive (stage B6) it holds the development mock only.
package vision

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"

	"lookly/internal/catalog"
)

// Detection is the attributes detected from a photo, with a confidence
// (0 to 1) for each.
type Detection struct {
	Category     string
	Subcategory  *string
	Colors       []string
	Pattern      *string
	Material     *string
	SleeveLength *string
	Fit          *string
	Style        *string
	Season       []string
	Gender       *string
	Formality    *string
	Confidence   map[string]float64
	// Mock: the development mock made the attributes, not a vision model.
	Mock bool
}

// The mock's provider, model and version, as stored on the items it analysed.
const (
	MockProvider = "mock"
	MockModel    = "mock-vision"
	MockVersion  = "mock"
)

// ConfidenceOrder is the attributes a detection has a confidence for, in
// the order the Next.js mock writes them (the stored JSON keeps it).
var ConfidenceOrder = []string{
	"category", "subcategory", "color", "pattern", "material", "style", "season", "sleeveLength", "fit", "formality", "gender",
}

// hints are the words in a file name that suggest a category, tried in this
// order (the Next.js mock's: apps/web/src/lib/ai/mock-vision.ts).
var hints = []struct {
	words    *regexp.Regexp
	category string
}{
	{regexp.MustCompile(`(shirt|futbolka|koylak|blouse|polo|tee)`), "shirt"},
	{regexp.MustCompile(`(jacket|kurtka|coat|palto|blazer|windbreaker|ustki)`), "outerwear"},
	{regexp.MustCompile(`(pant|jean|shim|chino|trouser|short)`), "pants"},
	{regexp.MustCompile(`(dress|koylak.*ayol|libos)`), "dress"},
	{regexp.MustCompile(`(shoe|sneaker|boot|loafer|oyqi)`), "shoes"},
	{regexp.MustCompile(`(bag|sumka|tote|backpack|clutch)`), "bag"},
	{regexp.MustCompile(`(belt|scarf|hat|watch|sun|access)`), "accessory"},
}

var (
	neutrals = []string{"white", "black", "gray", "beige", "navy", "cream", "ivory", "tan", "khaki"}
	vivid    = []string{"red", "orange", "pink", "yellow", "purple"}
)

// Mock is the development mock of garment analysis, the Next.js one ported:
// it is not a model. The colours are read from the pixels (sample is R, G, B
// bytes, imaging.Variants.Sample); the category is guessed from the file
// name; everything else follows from those by fixed rules, with low
// confidences so that no client presents it as fact.
func Mock(sample []byte, filename string) Detection {
	colors, brightness, uniformity := dominantColors(sample)

	category, categoryConfidence := "shirt", 0.18
	name := strings.ToLower(filename)
	for _, h := range hints {
		if h.words.MatchString(name) {
			category, categoryConfidence = h.category, 0.42
			break
		}
	}
	var subcategory *string
	if subs := catalog.Subcategories(category); len(subs) > 0 {
		subcategory = &subs[0].ID
	}

	colorConfidence := 0.86
	if brightness > 200 || brightness < 50 {
		colorConfidence = 0.94
	}

	pattern, patternConfidence := "striped", 0.22
	switch {
	case uniformity > 0.82:
		pattern, patternConfidence = "solid", 0.78
	case uniformity > 0.62:
		pattern, patternConfidence = "color_block", 0.34
	}

	has := func(ids ...string) bool {
		return slices.ContainsFunc(colors, func(c string) bool { return slices.Contains(ids, c) })
	}
	material, materialConfidence := "cotton", 0.21
	switch {
	case has("white", "cream", "ivory"):
		materialConfidence = 0.34
	case brightness < 80:
		material, materialConfidence = "wool", 0.22
	case brightness > 200:
		materialConfidence = 0.31
	}

	style, styleConfidence := "smart_casual", 0.22
	allNeutral := !slices.ContainsFunc(colors, func(c string) bool { return !slices.Contains(neutrals, c) })
	switch {
	case allNeutral:
		style, styleConfidence = "minimal", 0.38
	case has(vivid...):
		style, styleConfidence = "casual", 0.27
	}

	season, seasonConfidence := []string{"spring", "autumn"}, 0.24
	switch {
	case material == "wool":
		season, seasonConfidence = []string{"autumn", "winter"}, 0.41
	case brightness > 200:
		season, seasonConfidence = []string{"spring", "summer"}, 0.36
	case brightness < 80:
		season, seasonConfidence = []string{"autumn", "winter"}, 0.29
	}

	formality, formalityConfidence := "smart_casual", 0.28
	switch style {
	case "casual":
		formality, formalityConfidence = "casual", 0.31
	case "minimal":
		formalityConfidence = 0.29
	}

	sleeveLength, fit, gender := catalog.SleeveLengths[1], catalog.Fits[1], catalog.Genders[2] // long, regular, unisex
	return Detection{
		Category: category, Subcategory: subcategory, Colors: colors, Pattern: &pattern, Material: &material,
		SleeveLength: &sleeveLength, Fit: &fit, Style: &style, Season: season, Gender: &gender, Formality: &formality,
		Confidence: map[string]float64{
			"category": categoryConfidence, "subcategory": 0.15, "color": colorConfidence, "pattern": patternConfidence,
			"material": materialConfidence, "style": styleConfidence, "season": seasonConfidence,
			"sleeveLength": 0.12, "fit": 0.13, "formality": formalityConfidence, "gender": 0.18,
		},
		Mock: true,
	}
}

type rgb struct{ r, g, b float64 }

var palette = func() []rgb {
	out := make([]rgb, len(catalog.ColorEntries))
	for i, c := range catalog.ColorEntries {
		var r, g, b uint8
		if n, err := fmt.Sscanf(c.Hex, "#%02x%02x%02x", &r, &g, &b); err != nil || n != 3 || len(c.Hex) != 7 {
			panic("vision: catalog colour " + c.ID + " has no #RRGGBB value")
		}
		out[i] = rgb{float64(r), float64(g), float64(b)}
	}
	return out
}()

// dominantColors names each pixel by the nearest catalog colour and returns
// the one or two most frequent names (a second counts from 12 % of the
// pixels), the mean brightness (ITU-R BT.601, 0 to 255) and how uniform the
// brightness is (1: one tone; 0 or less: a standard deviation of 80 or more).
func dominantColors(sample []byte) (colors []string, brightness, uniformity float64) {
	pixels := len(sample) / 3
	if pixels == 0 {
		return []string{catalog.Colors[0]}, 0, 1
	}
	counts := make([]int, len(palette))
	var order []int // colours in the order they first appear: ties keep it
	values := make([]float64, 0, pixels)
	var total float64
	for i := 0; i+2 < len(sample); i += 3 {
		r, g, b := float64(sample[i]), float64(sample[i+1]), float64(sample[i+2])
		best, bestDistance := 0, math.Inf(1)
		for j, c := range palette {
			if d := math.Sqrt((r-c.r)*(r-c.r) + (g-c.g)*(g-c.g) + (b-c.b)*(b-c.b)); d < bestDistance {
				best, bestDistance = j, d
			}
		}
		if counts[best] == 0 {
			order = append(order, best)
		}
		counts[best]++
		v := 0.299*r + 0.587*g + 0.114*b
		values = append(values, v)
		total += v
	}
	slices.SortStableFunc(order, func(a, b int) int { return counts[b] - counts[a] })
	for _, j := range order {
		if float64(counts[j])/float64(pixels) >= 0.12 {
			colors = append(colors, catalog.Colors[j])
		}
		if len(colors) >= 2 {
			break
		}
	}
	if len(colors) == 0 {
		colors = []string{catalog.Colors[order[0]]}
	}
	mean := total / float64(pixels)
	var variance float64
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	deviation := math.Sqrt(variance / float64(pixels))
	return colors, mean, 1 - deviation/80
}
