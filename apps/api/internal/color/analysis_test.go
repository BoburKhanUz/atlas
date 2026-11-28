package color_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"math"
	"slices"
	"testing"

	"lookly/internal/catalog"
	"lookly/internal/color"
	"lookly/internal/golden"
	"lookly/internal/platform"
)

// close: the Go maths library and V8's can differ in the last bits of a
// result (pow, cbrt, atan2, hypot, exp); a class or a rounded confidence
// never does on these vectors.
func near(a, b float64) bool {
	return a == b || math.Abs(a-b) <= 1e-9*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
}

// sameJSON compares two decoded JSON values, numbers within near.
func sameJSON(path string, got, want any) error {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok || len(g) != len(w) {
			return fmt.Errorf("%s: got %v, want %v", path, got, want)
		}
		for k, v := range w {
			if err := sameJSON(path+"."+k, g[k], v); err != nil {
				return err
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return fmt.Errorf("%s: got %v, want %v", path, got, want)
		}
		for i := range w {
			if err := sameJSON(fmt.Sprintf("%s[%d]", path, i), g[i], w[i]); err != nil {
				return err
			}
		}
	case float64:
		if g, ok := got.(float64); !ok || !near(g, w) {
			return fmt.Errorf("%s: got %v, want %v", path, got, want)
		}
	default:
		if got != want {
			return fmt.Errorf("%s: got %v, want %v", path, got, want)
		}
	}
	return nil
}

func asJSON(t *testing.T, v any) any {
	t.Helper()
	encoded, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(encoded, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// canvasOf builds a golden canvas as the script did: the PNG's pixels, the
// fixture's seeded noise, then the edits.
func canvasOf(t *testing.T, c golden.ColorCanvas) color.Canvas {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(c.PNG)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	canvas := color.Canvas{Width: b.Dx(), Height: b.Dy(), RGB: make([]byte, 0, b.Dx()*b.Dy()*3)}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			canvas.RGB = append(canvas.RGB, byte(r>>8), byte(g>>8), byte(bl>>8))
		}
	}
	if c.Noise > 0 {
		s := c.Seed
		if s == 0 {
			s = 1
		}
		for i := 0; i < len(canvas.RGB); i += 3 {
			s = s*1664525 + 1013904223
			n := float64(float64(float64(s)/4294967296-0.5)*2) * c.Noise
			for ch := range 3 {
				canvas.RGB[i+ch] = byte(min(255, max(0, platform.RoundHalfUp(float64(canvas.RGB[i+ch])+n))))
			}
		}
	}
	for _, e := range c.Edits {
		edit(canvas, e)
	}
	return canvas
}

func edit(c color.Canvas, e golden.ColorEdit) {
	d := c.RGB
	switch e.Op {
	case "skinLeft":
		for y := range c.Height {
			for x := 0; float64(x) < float64(c.Width)/2; x++ {
				i := (y*c.Width + x) * 3
				if color.IsSkinPixel(d[i], d[i+1], d[i+2]) {
					copy(d[i:i+3], e.RGB[:])
				}
			}
		}
	case "rect":
		for y := e.Y; y < min(c.Height, e.Y+e.H); y++ {
			for x := e.X; x < min(c.Width, e.X+e.W); x++ {
				copy(d[(y*c.Width+x)*3:], e.RGB[:])
			}
		}
	case "scale":
		for i := range d {
			d[i] = byte(min(255, int(d[i])*e.Num/e.Den))
		}
	case "blur":
		src := bytes.Clone(d)
		for y := range c.Height {
			for x := range c.Width {
				for ch := range 3 {
					sum, n := 0, 0
					for yy := max(0, y-e.R); yy <= min(c.Height-1, y+e.R); yy++ {
						for xx := max(0, x-e.R); xx <= min(c.Width-1, x+e.R); xx++ {
							sum += int(src[(yy*c.Width+xx)*3+ch])
							n++
						}
					}
					d[(y*c.Width+x)*3+ch] = byte(sum / n)
				}
			}
		}
	default:
		panic("unknown edit " + e.Op)
	}
}

// outcome is a refusal as the vectors name it.
func outcome(err error) (kind, reason string) {
	var quality *color.PhotoQualityError
	switch {
	case errors.As(err, &quality):
		return "photo_quality", string(quality.Reason)
	case errors.Is(err, color.ErrSkinNotVisible):
		return "skin_not_visible", ""
	}
	return "other: " + err.Error(), ""
}

func TestTheAnalysisOfACanvasIsTheNextJSAnalysis(t *testing.T) {
	t.Parallel()
	g := golden.LoadColor(t)
	if g.Version != color.Version || g.CanvasMaxSide != color.CanvasMaxSide {
		t.Fatalf("version %s, canvas %d", g.Version, g.CanvasMaxSide)
	}
	for _, c := range g.Canvases {
		canvas := canvasOf(t, c)
		if sum := sha256.Sum256(canvas.RGB); hex.EncodeToString(sum[:]) != c.SHA256 {
			t.Fatalf("%s: the canvas is not the script's", c.Name)
		}
		q := color.MeasureQuality(canvas)
		if !near(q.MeanLuma, c.Quality.MeanLuma) || !near(q.LumaStd, c.Quality.LumaStd) || !near(q.CrushedShare, c.Quality.CrushedShare) ||
			!near(q.ClippedShare, c.Quality.ClippedShare) || !near(q.Sharpness, c.Quality.Sharpness) {
			t.Errorf("%s: quality %+v, want %+v", c.Name, q, c.Quality)
		}

		skin, err := color.MeasureSkin(canvas)
		switch want := c.Skin.Value; {
		case want == nil:
			if kind, reason := outcome(err); err == nil || kind != c.Skin.Error || reason != c.Skin.Reason {
				t.Errorf("%s: skin %+v %v, want %s %s", c.Name, skin, err, c.Skin.Error, c.Skin.Reason)
			}
		case err != nil:
			t.Errorf("%s: skin refused: %v", c.Name, err)
		default:
			box := color.Box{Top: want.Box.Top, Bottom: want.Box.Bottom, Left: want.Box.Left, Right: want.Box.Right}
			if !near(skin.Lab.L, want.Lab.L) || !near(skin.Lab.A, want.Lab.A) || !near(skin.Lab.B, want.Lab.B) || !near(skin.Luma, want.Luma) ||
				skin.Pixels != want.Pixels || skin.Cells != want.Cells || !near(skin.Agreement, want.Agreement) || skin.Box != box {
				t.Errorf("%s: skin %+v, want %+v", c.Name, skin, *want)
			}
		}

		result, err := color.AnalyzeCanvas(canvas)
		if c.Result.Value == nil {
			if kind, reason := outcome(err); err == nil || kind != c.Result.Error || reason != c.Result.Reason {
				t.Errorf("%s: %+v %v, want %s %s", c.Name, result, err, c.Result.Error, c.Result.Reason)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: refused: %v", c.Name, err)
			continue
		}
		var want any
		if err := json.Unmarshal(c.Result.Value, &want); err != nil {
			t.Fatal(err)
		}
		if err := sameJSON(c.Name, asJSON(t, result), want); err != nil {
			t.Error(err)
		}
	}
}

func lab(l golden.ColorLab) color.Lab { return color.Lab{L: l.L, A: l.A, B: l.B} }

func labPtr(l *golden.ColorLab) *color.Lab {
	if l == nil {
		return nil
	}
	v := lab(*l)
	return &v
}

func TestTheStepsOfTheAnalysisAreTheNextJSSteps(t *testing.T) {
	t.Parallel()
	g := golden.LoadColor(t)
	for _, c := range g.RGBToLab {
		got := color.RGBToLab(c.RGB[0], c.RGB[1], c.RGB[2])
		if !near(got.L, c.Lab.L) || !near(got.A, c.Lab.A) || !near(got.B, c.Lab.B) || color.IsSkinPixel(c.RGB[0], c.RGB[1], c.RGB[2]) != c.Skin {
			t.Errorf("%v: %+v skin %t, want %+v %t", c.RGB, got, color.IsSkinPixel(c.RGB[0], c.RGB[1], c.RGB[2]), c.Lab, c.Skin)
		}
	}
	for _, c := range g.Hue {
		l := lab(c.Lab)
		if !near(color.HueAngle(l), c.Hue) || !near(color.Chroma(l), c.Chroma) || color.HairColorOf(l) != c.Hair || color.EyeColorOf(l) != c.Eyes {
			t.Errorf("%+v: hue %v chroma %v hair %s eyes %s, want %+v", c.Lab, color.HueAngle(l), color.Chroma(l), color.HairColorOf(l), color.EyeColorOf(l), c)
		}
	}
	for _, c := range g.Undertone {
		if color.ClassifyUndertone(c.Hue) != c.Undertone || !near(color.UndertoneMargin(c.Hue), c.Margin) {
			t.Errorf("hue %v: %s %v, want %s %v", c.Hue, color.ClassifyUndertone(c.Hue), color.UndertoneMargin(c.Hue), c.Undertone, c.Margin)
		}
	}
	for _, c := range g.SkinTone {
		if got := color.ClassifySkinTone(c.L); got != c.SkinTone {
			t.Errorf("L %v: %s, want %s", c.L, got, c.SkinTone)
		}
	}
	for _, c := range g.Contrast {
		got := color.ContrastOf(lab(c.Skin), labPtr(c.Hair), labPtr(c.Eyes))
		if (got == nil) != (c.Contrast == nil) || got != nil && (got.Level != c.Contrast.Level || !near(got.Value, c.Contrast.Value)) {
			t.Errorf("%+v: %+v, want %+v", c, got, c.Contrast)
		}
	}
	for _, c := range g.SeasonFeatures {
		got := color.SeasonFeaturesOf(lab(c.Skin), c.UndertoneKnown, labPtr(c.Hair), c.Contrast)
		if err := sameJSON("features", asJSON(t, got), asJSON(t, c.Features)); err != nil {
			t.Errorf("%+v: %v", c, err)
		}
	}
	features := func(f golden.ColorFeatures) color.SeasonFeatures {
		return color.SeasonFeatures{Warmth: f.Warmth, Lightness: f.Lightness, Chroma: f.Chroma, Contrast: f.Contrast}
	}
	for _, c := range g.SeasonProbabilities {
		got := color.SeasonProbabilities(features(c.Features))
		if err := sameJSON("probabilities", asJSON(t, got), asJSON(t, c.Probabilities)); err != nil {
			t.Errorf("%+v: %v", c.Features, err)
		}
	}
	for _, c := range g.ConfidenceCap {
		if got := color.ConfidenceCap(c.UndertoneKnown, c.ContrastKnown); got != c.Cap {
			t.Errorf("%+v: %v", c, got)
		}
	}
	for _, c := range g.DecideSeason {
		probabilities := make([]color.Probability, len(c.Probabilities))
		for i, p := range c.Probabilities {
			probabilities[i] = color.Probability{Season: p.Season, P: p.P}
		}
		got := color.DecideSeason(probabilities, c.Evidence, c.Cap)
		if err := sameJSON("decision", asJSON(t, got), asJSON(t, c.Decision)); err != nil {
			t.Errorf("%+v: %v", c, err)
		}
	}
	for season, p := range g.Palettes {
		got := color.Palettes[season]
		if err := sameJSON(season, asJSON(t, got), asJSON(t, p)); err != nil {
			t.Error(err)
		}
	}
	if len(color.Palettes) != len(g.Palettes) {
		t.Errorf("palettes %v", color.Palettes)
	}
}

// The palettes name catalog colours only: what the Next.js code ensured by
// filtering each list by the catalog.
func TestThePalettesAreCatalogColours(t *testing.T) {
	t.Parallel()
	for season, p := range color.Palettes {
		for _, list := range [][]string{p.Recommended, p.Neutral, p.Caution} {
			for _, id := range list {
				if !slices.Contains(catalog.Colors, id) {
					t.Errorf("%s: %q is not a catalog colour", season, id)
				}
			}
		}
	}
}
