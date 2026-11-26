package imaging_test

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"math/rand/v2"
	"testing"
)

// A phone photo: 4032×3024, noisy (so it compresses as photos do).
func photo(b testing.TB, w, h int) []byte {
	b.Helper()
	img := image.NewYCbCr(image.Rect(0, 0, w, h), image.YCbCrSubsampleRatio420)
	r := rand.New(rand.NewPCG(1, 2))
	for i := range img.Y {
		img.Y[i] = uint8(100 + r.IntN(60))
	}
	for i := range img.Cb {
		img.Cb[i], img.Cr[i] = uint8(110+r.IntN(20)), uint8(130+r.IntN(20))
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		b.Fatal(err)
	}
	return buf.Bytes()
}

func BenchmarkPhonePhoto(b *testing.B) {
	data := photo(b, 4032, 3024)
	b.ResetTimer()
	for range b.N {
		if _, err := processor.Process(context.Background(), data); err != nil {
			b.Fatal(err)
		}
	}
}
