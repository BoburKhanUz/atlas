package golden

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"testing"

	"lookly/internal/platform"
)

// Color is testdata/golden/color.json (apps/web/scripts/golden-color.ts):
// the Next.js selfie colour analysis (color-analysis-v2) on synthetic
// canvases, and its pure steps.
type Color struct {
	GeneratedBy   string `json:"generatedBy"`
	SourceCommit  string `json:"sourceCommit"`
	Note          string `json:"note"`
	Version       string `json:"version"`
	CanvasMaxSide int    `json:"canvasMaxSide"`
	Thresholds    struct {
		Quality    map[string]float64 `json:"quality"`
		Skin       map[string]float64 `json:"skin"`
		Undertone  map[string]float64 `json:"undertone"`
		Confidence map[string]float64 `json:"confidence"`
	} `json:"thresholds"`
	Prototypes map[string]struct {
		Warmth    float64 `json:"warmth"`
		Lightness float64 `json:"lightness"`
		Chroma    float64 `json:"chroma"`
		Contrast  float64 `json:"contrast"`
	} `json:"prototypes"`
	Palettes map[string]struct {
		Recommended []string `json:"recommended"`
		Neutral     []string `json:"neutral"`
		Caution     []string `json:"caution"`
	} `json:"palettes"`
	Canvases []ColorCanvas `json:"canvases"`
	RGBToLab []struct {
		RGB  [3]uint8 `json:"rgb"`
		Lab  ColorLab `json:"lab"`
		Skin bool     `json:"skin"`
	} `json:"rgbToLab"`
	Hue []struct {
		Lab    ColorLab `json:"lab"`
		Hue    float64  `json:"hue"`
		Chroma float64  `json:"chroma"`
		Hair   string   `json:"hair"`
		Eyes   string   `json:"eyes"`
	} `json:"hue"`
	Undertone []struct {
		Hue       float64 `json:"hue"`
		Undertone string  `json:"undertone"`
		Margin    float64 `json:"margin"`
	} `json:"undertone"`
	SkinTone []struct {
		L        float64 `json:"L"`
		SkinTone string  `json:"skinTone"`
	} `json:"skinTone"`
	Contrast []struct {
		Skin     ColorLab  `json:"skin"`
		Hair     *ColorLab `json:"hair"`
		Eyes     *ColorLab `json:"eyes"`
		Contrast *struct {
			Level string  `json:"level"`
			Value float64 `json:"value"`
		} `json:"contrast"`
	} `json:"contrast"`
	SeasonFeatures []struct {
		Skin           ColorLab      `json:"skin"`
		UndertoneKnown bool          `json:"undertoneKnown"`
		Hair           *ColorLab     `json:"hair"`
		Contrast       *float64      `json:"contrast"`
		Features       ColorFeatures `json:"features"`
	} `json:"seasonFeatures"`
	SeasonProbabilities []struct {
		Features      ColorFeatures      `json:"features"`
		Probabilities []ColorProbability `json:"probabilities"`
	} `json:"seasonProbabilities"`
	ConfidenceCap []struct {
		UndertoneKnown bool    `json:"undertoneKnown"`
		ContrastKnown  bool    `json:"contrastKnown"`
		Cap            float64 `json:"cap"`
	} `json:"confidenceCap"`
	DecideSeason []struct {
		Probabilities []ColorProbability `json:"probabilities"`
		Evidence      float64            `json:"evidence"`
		Cap           float64            `json:"cap"`
		Decision      struct {
			Season              *string  `json:"season"`
			Confidence          float64  `json:"confidence"`
			SecondarySeason     *string  `json:"secondarySeason"`
			SecondaryConfidence *float64 `json:"secondaryConfidence"`
		} `json:"decision"`
	} `json:"decideSeason"`
}

// ColorLab is a CIELAB colour.
type ColorLab struct {
	L float64 `json:"L"`
	A float64 `json:"a"`
	B float64 `json:"b"`
}

// ColorFeatures are a season's features (warmth and contrast may be null).
type ColorFeatures struct {
	Warmth    *float64 `json:"warmth"`
	Lightness float64  `json:"lightness"`
	Chroma    float64  `json:"chroma"`
	Contrast  *float64 `json:"contrast"`
}

// ColorProbability is a season's probability.
type ColorProbability struct {
	Season string  `json:"season"`
	P      float64 `json:"p"`
}

// ColorEdit is a change made to a canvas after its noise.
type ColorEdit struct {
	Op  string   `json:"op"` // skinLeft, rect, scale, blur
	RGB [3]uint8 `json:"rgb"`
	X   int      `json:"x"`
	Y   int      `json:"y"`
	W   int      `json:"w"`
	H   int      `json:"h"`
	Num int      `json:"num"`
	Den int      `json:"den"`
	R   int      `json:"r"`
}

// ColorCanvas is a synthetic selfie canvas and what the analysis made of it.
type ColorCanvas struct {
	Name string `json:"name"`
	// PNG is the canvas before its noise (base64).
	PNG     string      `json:"png"`
	Noise   float64     `json:"noise"`
	Seed    uint32      `json:"seed"`
	Edits   []ColorEdit `json:"edits"`
	SHA256  string      `json:"sha256"`
	Quality struct {
		MeanLuma     float64 `json:"meanLuma"`
		LumaStd      float64 `json:"lumaStd"`
		CrushedShare float64 `json:"crushedShare"`
		ClippedShare float64 `json:"clippedShare"`
		Sharpness    float64 `json:"sharpness"`
	} `json:"quality"`
	Skin struct {
		Value *struct {
			Lab       ColorLab `json:"lab"`
			Luma      float64  `json:"luma"`
			Pixels    int      `json:"pixels"`
			Cells     int      `json:"cells"`
			Agreement float64  `json:"agreement"`
			Box       struct {
				Top    int `json:"top"`
				Bottom int `json:"bottom"`
				Left   int `json:"left"`
				Right  int `json:"right"`
			} `json:"box"`
		} `json:"value"`
		Error  string `json:"error"`
		Reason string `json:"reason"`
	} `json:"skin"`
	Result struct {
		Value  json.RawMessage `json:"value"`
		Error  string          `json:"error"`
		Reason string          `json:"reason"`
	} `json:"result"`
}

// LoadColor reads testdata/golden/color.json; unknown fields fail.
func LoadColor(t testing.TB) Color {
	t.Helper()
	var c Color
	load(t, "color.json", &c)
	if len(c.Canvases) == 0 || len(c.RGBToLab) == 0 || len(c.SeasonProbabilities) == 0 || len(c.DecideSeason) == 0 {
		t.Fatal("color.json: a section is empty")
	}
	return c
}

// Pixels are the canvas as the script analysed it: the PNG's pixels, the
// selfie fixture's seeded noise (its LCG, rounded as Math.round), then the
// edits. isSkin is the analysis's skin test (for the skinLeft edit).
func (c ColorCanvas) Pixels(t testing.TB, isSkin func(r, g, b uint8) bool) (rgb []byte, width, height int) {
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
	width, height = b.Dx(), b.Dy()
	rgb = make([]byte, 0, width*height*3)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			rgb = append(rgb, byte(r>>8), byte(g>>8), byte(bl>>8))
		}
	}
	if c.Noise > 0 {
		s := c.Seed
		if s == 0 {
			s = 1
		}
		for i := 0; i < len(rgb); i += 3 {
			s = s*1664525 + 1013904223
			n := float64(float64(float64(s)/4294967296-0.5)*2) * c.Noise
			for ch := range 3 {
				rgb[i+ch] = byte(min(255, max(0, platform.RoundHalfUp(float64(rgb[i+ch])+n))))
			}
		}
	}
	for _, e := range c.Edits {
		e.apply(rgb, width, height, isSkin)
	}
	return rgb, width, height
}

func (e ColorEdit) apply(d []byte, width, height int, isSkin func(r, g, b uint8) bool) {
	switch e.Op {
	case "skinLeft":
		for y := range height {
			for x := 0; float64(x) < float64(width)/2; x++ {
				i := (y*width + x) * 3
				if isSkin(d[i], d[i+1], d[i+2]) {
					copy(d[i:i+3], e.RGB[:])
				}
			}
		}
	case "rect":
		for y := e.Y; y < min(height, e.Y+e.H); y++ {
			for x := e.X; x < min(width, e.X+e.W); x++ {
				copy(d[(y*width+x)*3:], e.RGB[:])
			}
		}
	case "scale":
		for i := range d {
			d[i] = byte(min(255, int(d[i])*e.Num/e.Den))
		}
	case "blur":
		src := bytes.Clone(d)
		for y := range height {
			for x := range width {
				for ch := range 3 {
					sum, n := 0, 0
					for yy := max(0, y-e.R); yy <= min(height-1, y+e.R); yy++ {
						for xx := max(0, x-e.R); xx <= min(width-1, x+e.R); xx++ {
							sum += int(src[(yy*width+xx)*3+ch])
							n++
						}
					}
					d[(y*width+x)*3+ch] = byte(sum / n)
				}
			}
		}
	default:
		panic("color.json: unknown edit " + e.Op)
	}
}

// Canvas is the named canvas.
func (c Color) Canvas(t testing.TB, name string) ColorCanvas {
	t.Helper()
	for _, cv := range c.Canvases {
		if cv.Name == name {
			return cv
		}
	}
	t.Fatalf("color.json: no canvas %q", name)
	return ColorCanvas{}
}
