package imaging_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gen2brain/webp"
	xwebp "golang.org/x/image/webp"

	"lookly/internal/contracttest"
	"lookly/internal/golden"
	"lookly/internal/imaging"
)

func fixture(t testing.TB, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(contracttest.RepoPath("apps/api/testdata/images/" + name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func decode(t *testing.T, format string, b []byte) image.Image {
	t.Helper()
	var img image.Image
	var err error
	switch format {
	case "jpeg":
		img, err = jpeg.Decode(bytes.NewReader(b))
	case "png":
		img, err = png.Decode(bytes.NewReader(b))
	case "webp":
		img, err = xwebp.Decode(bytes.NewReader(b))
	default:
		t.Fatalf("format %q", format)
	}
	if err != nil {
		t.Fatalf("%s variant does not decode: %v", format, err)
	}
	return img
}

// sniff names the format of stored bytes by their signature.
func sniff(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte{0xff, 0xd8, 0xff}):
		return "jpeg"
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case len(b) > 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "webp"
	}
	return "?"
}

// redCorner is the corner of the picture whose average is reddest, as the
// golden script measures it.
func redCorner(img image.Image) string {
	b := img.Bounds()
	best, corner := -1e9, ""
	for i, name := range []string{"top-left", "top-right", "bottom-left", "bottom-right"} {
		x0, y0 := b.Min.X+(i%2)*b.Dx()/2, b.Min.Y+(i/2)*b.Dy()/2
		var r, g, bl, n float64
		for y := y0; y < y0+b.Dy()/2; y += 4 {
			for x := x0; x < x0+b.Dx()/2; x += 4 {
				c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
				r, g, bl, n = r+float64(c.R), g+float64(c.G), bl+float64(c.B), n+1
			}
		}
		if redness := (r - (g+bl)/2) / n; redness > best {
			best, corner = redness, name
		}
	}
	return corner
}

// hasMetadata reports whether encoded bytes carry EXIF, XMP or an ICC
// profile (any of the markers or chunks that hold them).
func hasMetadata(b []byte) bool {
	for _, marker := range []string{"Exif\x00\x00", "http://ns.adobe.com/xap", "ICC_PROFILE", "eXIf", "iCCP", "iTXt", "tEXt", "zTXt", "EXIF", "XMP ", "ICCP"} {
		if bytes.Contains(b, []byte(marker)) {
			return true
		}
	}
	return false
}

var processor = imaging.NewProcessor(2)

// Every fixture gets the Next.js server's outcome: accepted with the same
// master format, dimensions after orientation, variant sizes, the picture
// turned the same way, and no metadata; or the same refusal.
func TestImagesAreProcessedAsTheNextJSServerProcessesThem(t *testing.T) {
	t.Parallel()
	g := golden.LoadImages(t)
	refusals := map[string]error{
		"UNSUPPORTED_IMAGE_FORMAT": imaging.ErrUnsupported,
		"INVALID_IMAGE":            imaging.ErrInvalid,
		"IMAGE_DIMENSIONS":         imaging.ErrDimensions,
	}
	for _, f := range g.Fixtures {
		v, err := processor.Process(context.Background(), fixture(t, f.File))
		if f.Outcome != "ok" {
			if !errors.Is(err, refusals[f.Outcome]) {
				t.Errorf("%s (%s): err %v, want %s", f.File, f.About, err, f.Outcome)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s (%s): %v", f.File, f.About, err)
			continue
		}
		if v.Width != f.Width || v.Height != f.Height || v.MIMEType != f.MimeType || v.Ext != f.Master.Ext {
			t.Errorf("%s: %dx%d %s .%s, want %dx%d %s .%s", f.File, v.Width, v.Height, v.MIMEType, v.Ext, f.Width, f.Height, f.MimeType, f.Master.Ext)
		}
		for _, variant := range []struct {
			name  string
			bytes []byte
			want  *golden.ImageMetadata
		}{{"master", v.Master, f.Master}, {"display", v.Display, f.Display}, {"thumbnail", v.Thumbnail, f.Thumbnail}} {
			format := sniff(variant.bytes)
			if format != variant.want.Format {
				t.Errorf("%s %s: format %s, want %s", f.File, variant.name, format, variant.want.Format)
				continue
			}
			img := decode(t, format, variant.bytes)
			if img.Bounds().Dx() != variant.want.Width || img.Bounds().Dy() != variant.want.Height {
				t.Errorf("%s %s: %dx%d, want %dx%d", f.File, variant.name, img.Bounds().Dx(), img.Bounds().Dy(), variant.want.Width, variant.want.Height)
			}
			if hasMetadata(variant.bytes) {
				t.Errorf("%s %s: metadata left in the file", f.File, variant.name)
			}
			if f.RedCorner != "" && variant.name == "display" {
				if corner := redCorner(img); corner != f.RedCorner {
					t.Errorf("%s: the red quarter is %s, want %s", f.File, corner, f.RedCorner)
				}
			}
		}
		if strings.Contains(string(v.Master)+string(v.Display)+string(v.Thumbnail), "secret-owner") {
			t.Errorf("%s: EXIF text survived", f.File)
		}
	}
}

func solidPNG(t testing.TB, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 220, 30, 30, 255
	}
	var buf bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// The limits on sides and pixels, at and past their boundaries. One
// deliberate difference: past 40 million pixels the Next.js server answers
// INVALID_IMAGE (sharp's pixel limit fails the decode); here it is what it
// is, IMAGE_DIMENSIONS, found from the header before anything is decoded.
func TestTheLimitsOfSidesAndPixels(t *testing.T) {
	t.Parallel()
	g := golden.LoadImages(t)
	for _, l := range g.Large {
		v, err := processor.Process(context.Background(), solidPNG(t, l.Width, l.Height))
		want := l.Outcome
		if l.Width*l.Height > 40_000_000 && l.Width <= 8000 && l.Height <= 8000 && want == "INVALID_IMAGE" {
			want = "IMAGE_DIMENSIONS" // the deliberate difference
		}
		switch want {
		case "ok":
			if err != nil {
				t.Errorf("%dx%d: %v", l.Width, l.Height, err)
				continue
			}
			for _, variant := range []struct {
				b    []byte
				want *golden.ImageMetadata
			}{{v.Display, l.Display}, {v.Thumbnail, l.Thumbnail}} {
				img := decode(t, "webp", variant.b)
				if img.Bounds().Dx() != variant.want.Width || img.Bounds().Dy() != variant.want.Height {
					t.Errorf("%dx%d: a variant is %dx%d, want %dx%d", l.Width, l.Height, img.Bounds().Dx(), img.Bounds().Dy(), variant.want.Width, variant.want.Height)
				}
			}
		case "IMAGE_DIMENSIONS":
			if !errors.Is(err, imaging.ErrDimensions) {
				t.Errorf("%dx%d: err %v, want IMAGE_DIMENSIONS", l.Width, l.Height, err)
			}
		default:
			t.Errorf("%dx%d: unexpected golden outcome %s", l.Width, l.Height, want)
		}
	}
}

// A header that claims a huge picture is refused from the header alone:
// fast, and without the memory the pixels would take.
func TestAHugeClaimIsRefusedBeforeDecoding(t *testing.T) {
	t.Parallel()
	// A PNG header claiming 60000×60000 pixels, then nothing.
	var buf bytes.Buffer
	img := image.NewGray(image.Rect(0, 0, 1, 1))
	_ = png.Encode(&buf, img)
	b := buf.Bytes()
	// IHDR width and height are bytes 16..24 (big endian), its CRC 29..33
	// over the type and the data.
	copy(b[16:24], []byte{0, 0, 0xea, 0x60, 0, 0, 0xea, 0x60})
	binary.BigEndian.PutUint32(b[29:33], crc32.ChecksumIEEE(b[12:29]))
	start := time.Now()
	_, err := processor.Process(context.Background(), b)
	if !errors.Is(err, imaging.ErrDimensions) || time.Since(start) > time.Second {
		t.Fatalf("err %v after %s", err, time.Since(start))
	}
}

// The WebP encoder is the transpiled one the project reviewed, never a
// libwebp of the machine (ADR 0009). This fails for a test run without
// `-tags nodynamic` on a machine that has libwebp.
func TestTheWebPEncoderIsTheBuiltInOne(t *testing.T) {
	t.Parallel()
	if err := imaging.CheckEncoder(); err != nil {
		t.Fatal(err)
	}
	if webp.Dynamic() == nil {
		t.Fatal("a system libwebp is loaded")
	}
}

// At most n images are processed at a time; the others wait, and stop
// waiting with their context.
func TestProcessingIsBounded(t *testing.T) {
	t.Parallel()
	p := imaging.NewProcessor(1)
	release := p.Hold()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := p.Process(ctx, fixture(t, "marked.png")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("while the slot is taken: err %v", err)
	}
	release()
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.Process(context.Background(), fixture(t, "marked.png")); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
}

// Whatever the bytes, processing ends in a result or one of the three
// refusals, never a panic or another error.
func FuzzProcess(f *testing.F) {
	for _, fx := range golden.LoadImages(f).Fixtures {
		b := fixture(f, fx.File)
		if len(b) < 20000 {
			f.Add(b)
		}
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		_, err := processor.Process(context.Background(), b)
		if err != nil && !errors.Is(err, imaging.ErrInvalid) && !errors.Is(err, imaging.ErrUnsupported) && !errors.Is(err, imaging.ErrDimensions) {
			t.Fatalf("err %v", err)
		}
	})
}
