package evaluation_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"math/rand/v2"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/color"
	"lookly/internal/config"
	"lookly/internal/evaluation"
	"lookly/internal/golden"
	"lookly/internal/imaging"
)

// The local cost of everything the server does around a provider call
// (the evaluation harness's former timings.ts; docs/plan/B7.md, B7.4h):
// the stylist's and the outfit's request (engine, context, messages), a
// phone photo's preparation for a vision model, a selfie's colour analysis.
// No provider is asked (dry runs). Machine-dependent: report the hardware
// with the numbers.
//
//	go test -tags nodynamic -run '^$' -bench . ./internal/evaluation/

func runner(b *testing.B) *evaluation.Runner {
	b.Helper()
	mock := config.AIRoute{Provider: config.AIMock, Model: "mock", Timeout: time.Second}
	counter := &evaluation.Counter{}
	client, err := ai.NewClient(config.AI{LLM: mock, Stylist: mock, Outfit: mock, Vision: config.AIVision{Provider: config.AIMock, Model: "mock", Timeout: time.Second, MaxSide: 1024}}, ai.DefaultAddresses, counter)
	if err != nil {
		b.Fatal(err)
	}
	return &evaluation.Runner{Text: client, Images: client, Pictures: imaging.NewProcessor(1), Counter: counter, TextTimeout: time.Second,
		VisionDefaults: evaluation.VisionSettings{MaxSide: 1024, Timeout: time.Second}}
}

// wardrobe is 40 items across every category.
func wardrobe() []map[string]any {
	kinds := []struct{ category, subcategory string }{{"shirt", "tshirt"}, {"shirt", "oxford_shirt"}, {"pants", "jeans"}, {"pants", "chinos"}, {"shoes", "sneakers"}, {"shoes", "loafers"}, {"outerwear", "jacket"}, {"dress", "midi_dress"}}
	colors := []string{"white", "black", "navy", "beige", "gray"}
	var out []map[string]any
	for i := range 40 {
		k := kinds[i%len(kinds)]
		out = append(out, map[string]any{
			"id": fmt.Sprintf("w%d", i), "category": k.category, "subcategory": k.subcategory, "colors": []string{colors[i%len(colors)]},
			"season": []string{"spring", "autumn"}, "formality": "casual", "style": "casual", "createdAt": "2026-01-01T00:00:00.000Z",
		})
	}
	return out
}

func line(b *testing.B, request map[string]any) []byte {
	b.Helper()
	encoded, err := json.Marshal(request)
	if err != nil {
		b.Fatal(err)
	}
	return append(encoded, '\n')
}

// bench runs one request per iteration, once checked to give what is
// expected (a request Go refused would measure nothing).
func bench(b *testing.B, request []byte, want string) {
	r := runner(b)
	var first bytes.Buffer
	if err := r.Run(context.Background(), bytes.NewReader(request), &first); err != nil {
		b.Fatal(err)
	}
	if !bytes.Contains(first.Bytes(), []byte(want)) || bytes.Contains(first.Bytes(), []byte(`"refused"`)) {
		b.Fatalf("the request gave %.300s", first.String())
	}
	b.ResetTimer()
	for range b.N {
		if err := r.Run(context.Background(), bytes.NewReader(request), io.Discard); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkStylistRequest(b *testing.B) {
	bench(b, line(b, map[string]any{"feature": "stylist", "dryRun": true, "case": map[string]any{"wardrobe": wardrobe(), "occasion": "work", "message": "Ertaga ishga nima kiyay?"}}), `"refs":["W1"`)
}

func BenchmarkOutfitRequest(b *testing.B) {
	items := wardrobe()
	for _, it := range items {
		delete(it, "createdAt")
	}
	bench(b, line(b, map[string]any{"feature": "outfit", "dryRun": true, "case": map[string]any{"wardrobe": items, "occasion": "casual", "topN": 3}}), `"ref":"O3"`)
}

func BenchmarkPhonePhotoForAVisionModel(b *testing.B) {
	img := image.NewYCbCr(image.Rect(0, 0, 3000, 4000), image.YCbCrSubsampleRatio420)
	rnd := rand.New(rand.NewPCG(1, 2))
	for i := range img.Y {
		img.Y[i] = uint8(100 + rnd.IntN(60))
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		b.Fatal(err)
	}
	bench(b, line(b, map[string]any{"feature": "vision", "dryRun": true, "case": map[string]any{"image": base64.StdEncoding.EncodeToString(buf.Bytes()), "maxSide": 1024}}), `"picture":{"mimeType":"image/jpeg","width":768,"height":1024`)
}

func BenchmarkSelfieColourAnalysis(b *testing.B) {
	var canvas *golden.ColorCanvas
	for _, c := range golden.LoadColor(b).Canvases {
		if c.Name == "largest" {
			canvas = &c
		}
	}
	if canvas == nil {
		b.Fatal("no vector named largest")
	}
	rgb, w, h := canvas.Pixels(b, color.IsSkinPixel)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		copy(img.Pix[4*i:], []byte{rgb[3*i], rgb[3*i+1], rgb[3*i+2], 255})
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		b.Fatal(err)
	}
	bench(b, line(b, map[string]any{"feature": "color", "case": map[string]any{"image": base64.StdEncoding.EncodeToString(buf.Bytes())}}), `"kind":"profile"`)
}
