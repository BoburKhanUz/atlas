package vision_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/imaging"
	"lookly/internal/vision"
)

var processor = imaging.NewProcessor(2)

func sampleOf(t *testing.T, file string) []byte {
	t.Helper()
	v, err := processor.Process(context.Background(), golden.TestdataFile(t, file))
	if err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	if len(v.Sample) != imaging.SampleSide*imaging.SampleSide*3 {
		t.Fatalf("%s: a sample of %d bytes", file, len(v.Sample))
	}
	return v.Sample
}

// asGolden is a detection in the golden file's shape.
func asGolden(t *testing.T, d vision.Detection) golden.VisionDetection {
	t.Helper()
	return golden.VisionDetection{
		Category: d.Category, Subcategory: d.Subcategory, Colors: d.Colors, Pattern: d.Pattern, Material: d.Material,
		SleeveLength: d.SleeveLength, Fit: d.Fit, Style: d.Style, Season: d.Season, Gender: d.Gender, Formality: d.Formality,
		Confidence: d.Confidence, Mock: d.Mock,
	}
}

// The mock makes of each picture what the Next.js mock makes of it: the
// colours read from the pixels, and everything that follows from them.
func TestTheMockReadsPicturesAsTheNextMockDoes(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadVision(t).Detections {
		t.Run(c.File, func(t *testing.T) {
			t.Parallel()
			got := asGolden(t, vision.Mock(sampleOf(t, c.File), c.Filename))
			if !reflect.DeepEqual(got, c.Detection) {
				a, _ := json.Marshal(got)
				b, _ := json.Marshal(c.Detection)
				t.Errorf("%s:\n got %s\nwant %s", c.About, a, b)
			}
		})
	}
}

// The file name hints at the category, by the Next.js mock's words in its
// order; without a hint the guess is a shirt, with less confidence.
func TestTheMockTakesTheCategoryFromTheFileName(t *testing.T) {
	t.Parallel()
	g := golden.LoadVision(t)
	sample := sampleOf(t, g.HintPicture)
	for _, c := range g.Hints {
		d := vision.Mock(sample, c.Filename)
		if d.Category != c.Category || !reflect.DeepEqual(d.Subcategory, c.Subcategory) || d.Confidence["category"] != c.CategoryConfidence {
			t.Errorf("%q: %s/%v (%v), want %s/%v (%v)", c.Filename, d.Category, deref(d.Subcategory), d.Confidence["category"], c.Category, deref(c.Subcategory), c.CategoryConfidence)
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// A sample of no pixels (never made by the image pipeline) is still answered.
func TestTheMockWithoutPixels(t *testing.T) {
	t.Parallel()
	d := vision.Mock(nil, "x")
	if len(d.Colors) != 1 || !d.Mock {
		t.Fatalf("%+v", d)
	}
}
