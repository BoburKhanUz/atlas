package imaging_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"lookly/internal/imaging"
)

func prepare(t *testing.T, name string, maxSide int) imaging.VisionInput {
	t.Helper()
	in, err := processor.PrepareVision(context.Background(), fixture(t, name), maxSide)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return in
}

func near(t *testing.T, what string, got color.Color, want [3]int, tolerance int) {
	t.Helper()
	c := color.NRGBAModel.Convert(got).(color.NRGBA)
	for i, v := range []uint8{c.R, c.G, c.B} {
		if d := int(v) - want[i]; d > tolerance || d < -tolerance {
			t.Errorf("%s: %v, want about %v", what, c, want)
			return
		}
	}
}

// What leaves the server for a vision model: a JPEG, upright, within the
// longest side asked for and never enlarged, without metadata.
func TestThePictureSentToAModelIsAnUprightJPEGWithoutMetadata(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name          string
		maxSide, w, h int
	}{
		{"orientation-6.jpg", 1024, 400, 300}, // stored 300×400, turned
		{"orientation-6.jpg", 200, 200, 150},
		{"gps.jpg", 2048, 300, 400},
		{"gps.jpg", 100, 75, 100},
		{"min.png", 1024, 256, 256},
		{"orientation-6.webp", 160, 160, 120},
	} {
		in := prepare(t, c.name, c.maxSide)
		if sniff(in.JPEG) != "jpeg" || hasMetadata(in.JPEG) {
			t.Errorf("%s: not a bare JPEG (%s, metadata %t)", c.name, sniff(in.JPEG), hasMetadata(in.JPEG))
		}
		img := decode(t, "jpeg", in.JPEG)
		if img.Bounds().Dx() != c.w || img.Bounds().Dy() != c.h || in.Width != c.w || in.Height != c.h {
			t.Errorf("%s at %d: %v (%d×%d), want %d×%d", c.name, c.maxSide, img.Bounds().Size(), in.Width, in.Height, c.w, c.h)
		}
	}
	// Upright as the stored variants are.
	for _, name := range []string{"orientation-3.jpg", "orientation-6.jpg", "orientation-8.jpg", "orientation-6.png"} {
		v, err := processor.Process(context.Background(), fixture(t, name))
		if err != nil {
			t.Fatal(err)
		}
		if got, want := redCorner(decode(t, "jpeg", prepare(t, name, 512).JPEG)), redCorner(decode(t, "webp", v.Display)); got != want {
			t.Errorf("%s: red corner %s, the stored picture's %s", name, got, want)
		}
	}
}

// Transparency is laid on white for the model (JPEG has none, and black
// would read as the garment's background) and on grey for the blur measure.
func TestTransparencyIsFlattened(t *testing.T) {
	t.Parallel()
	in := prepare(t, "alpha.png", 1024)
	// 30, 60, 220 at half opacity.
	near(t, "on white", decode(t, "jpeg", in.JPEG).At(150, 150), [3]int{142, 157, 237}, 3)
	i := (150*in.CanvasWidth + 150) * 3
	near(t, "on grey", color.RGBA{in.Canvas[i], in.Canvas[i+1], in.Canvas[i+2], 255}, [3]int{79, 94, 174}, 1)
}

// The blur measure's canvas: the upright picture within 320 pixels, never
// enlarged, as R, G, B bytes.
func TestTheCanvasForTheBlurMeasure(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		w, h int
	}{
		{"orientation-6.jpg", 320, 240},
		{"gps.jpg", 240, 320},
		{"min.png", 256, 256},
	} {
		in := prepare(t, c.name, 64)
		if in.CanvasWidth != c.w || in.CanvasHeight != c.h || len(in.Canvas) != c.w*c.h*3 {
			t.Errorf("%s: canvas %d×%d (%d bytes), want %d×%d", c.name, in.CanvasWidth, in.CanvasHeight, len(in.Canvas), c.w, c.h)
		}
	}
	// The canvas is made from the original, not from the smaller picture
	// sent to the model.
	small, large := prepare(t, "orientation-6.jpg", 64), prepare(t, "orientation-6.jpg", 2048)
	if !bytes.Equal(small.Canvas, large.Canvas) {
		t.Error("the canvas depends on the size sent to the model")
	}
}

func TestAPictureThatCannotBePreparedIsRefused(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		want error
	}{
		{"garbage.bin", imaging.ErrInvalid},
		{"truncated.jpg", imaging.ErrInvalid},
		{"picture.gif", imaging.ErrUnsupported},
		{"heic-brand.bin", imaging.ErrUnsupported},
		{"tiny.png", imaging.ErrDimensions},
	} {
		if _, err := processor.PrepareVision(context.Background(), fixture(t, c.name), 1024); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}
	for _, side := range []int{0, -1, imaging.MaxVisionSide + 1} {
		if _, err := processor.PrepareVision(context.Background(), fixture(t, "gps.jpg"), side); err == nil {
			t.Errorf("a longest side of %d was accepted", side)
		}
	}
	if _, err := processor.PrepareVision(context.Background(), fixture(t, "gps.jpg"), imaging.MaxVisionSide); err != nil {
		t.Errorf("the largest side: %v", err)
	}
}

func TestPreparingWaitsForASlot(t *testing.T) {
	t.Parallel()
	p := imaging.NewProcessor(1)
	release := p.Hold()
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.PrepareVision(ctx, fixture(t, "gps.jpg"), 512); !errors.Is(err, imaging.ErrBusy) || !errors.Is(err, context.Canceled) {
		t.Fatalf("with every slot taken: %v", err)
	}
}

// The centre sample of the colour check: the given rectangle of a picture
// scaled to side×side, as R, G, B bytes. A rectangle of that size is taken
// as it is.
func TestTheCentreSample(t *testing.T) {
	t.Parallel()
	img := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	for y := range 10 {
		for x := range 10 {
			img.Set(x, y, color.NRGBA{uint8(x * 20), uint8(y * 20), 7, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	got, err := imaging.CentreSample(buf.Bytes(), image.Rect(2, 3, 5, 7), 3, 4)
	if err != nil {
		t.Fatal(err)
	}
	var want []byte
	for y := 3; y < 7; y++ {
		for x := 2; x < 5; x++ {
			want = append(want, uint8(x*20), uint8(y*20), 7)
		}
	}
	if !bytes.Equal(got, want) {
		t.Errorf("an exact crop:\n got %v\nwant %v", got, want)
	}
	scaled, err := imaging.CentreSample(buf.Bytes(), image.Rect(0, 0, 10, 10), 2, 2)
	if err != nil || len(scaled) != 12 {
		t.Fatalf("scaled: %d bytes, %v", len(scaled), err)
	}
	// From a JPEG too, and a rectangle outside the picture is refused.
	var j bytes.Buffer
	if err := jpeg.Encode(&j, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if s, err := imaging.CentreSample(j.Bytes(), image.Rect(0, 0, 4, 4), 4, 4); err != nil || len(s) != 48 {
		t.Errorf("from a JPEG: %d bytes, %v", len(s), err)
	}
	for _, r := range []image.Rectangle{image.Rect(5, 5, 11, 8), image.Rect(-1, 0, 3, 3), image.Rect(2, 2, 2, 5)} {
		if _, err := imaging.CentreSample(buf.Bytes(), r, 4, 4); err == nil {
			t.Errorf("%v was taken from a 10×10 picture", r)
		}
	}
	for _, bad := range [][]byte{[]byte("not a picture"), fixture(t, "truncated.jpg")} {
		if _, err := imaging.CentreSample(bad, image.Rect(0, 0, 1, 1), 1, 1); !errors.Is(err, imaging.ErrInvalid) {
			t.Errorf("not a picture: %v", err)
		}
	}
}

// The JPEG's quality is 85: the standard luminance quantisers 16, 11, 12
// scaled by 30 % (Go's encoder: (q×30+50)/100) are 5, 3, 4.
func TestTheJPEGQuality(t *testing.T) {
	t.Parallel()
	b := prepare(t, "gps.jpg", 512).JPEG
	i := bytes.Index(b, []byte{0xff, 0xdb})
	if i < 0 || len(b) < i+6 {
		t.Fatal("no quantisation table")
	}
	if pq, q := b[i+4], b[i+5:i+8]; pq != 0 || !bytes.Equal(q, []byte{5, 3, 4}) {
		t.Errorf("table %#x, first quantisers %v, want 0 and [5 3 4]", pq, q)
	}
}

func TestAHeaderThatDisagreesWithThePixelsIsNotPrepared(t *testing.T) {
	t.Parallel()
	p := imaging.NewProcessorWithDecoders(1, nil, func([]byte) (image.Image, error) {
		return image.NewNRGBA(image.Rect(0, 0, 300, 300)), nil
	})
	if _, err := p.PrepareVision(context.Background(), fixture(t, "gps.jpg"), 512); !errors.Is(err, imaging.ErrInvalid) {
		t.Fatalf("pixels of another size than the header's: %v", err)
	}
	panicking := imaging.NewProcessorWithDecoders(1, nil, func([]byte) (image.Image, error) { panic("decoder bug") })
	var panicked *imaging.DecoderPanic
	if _, err := panicking.PrepareVision(context.Background(), fixture(t, "gps.jpg"), 512); !errors.As(err, &panicked) || !errors.Is(err, imaging.ErrInvalid) {
		t.Fatalf("a decoder's panic: %v", err)
	}
}

// The selfie colour analysis's canvas is the vision canvas: the same
// pixels, without a JPEG being made.
func TestTheColourCanvasIsTheVisionCanvas(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"orientation-6.jpg", "gps.jpg", "min.png", "alpha.png", "orientation-8.jpg", "orientation-6.webp"} {
		rgb, w, h, err := processor.Canvas(context.Background(), fixture(t, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		in := prepare(t, name, 64)
		if w != in.CanvasWidth || h != in.CanvasHeight || !bytes.Equal(rgb, in.Canvas) {
			t.Errorf("%s: %d×%d, the vision canvas %d×%d (same bytes: %t)", name, w, h, in.CanvasWidth, in.CanvasHeight, bytes.Equal(rgb, in.Canvas))
		}
	}
	for _, c := range []struct {
		name string
		want error
	}{
		{"garbage.bin", imaging.ErrInvalid},
		{"truncated.jpg", imaging.ErrInvalid},
		{"picture.gif", imaging.ErrUnsupported},
		{"heic-brand.bin", imaging.ErrUnsupported},
		{"tiny.png", imaging.ErrDimensions},
	} {
		if _, _, _, err := processor.Canvas(context.Background(), fixture(t, c.name)); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}
	p := imaging.NewProcessor(1)
	release := p.Hold()
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, _, err := p.Canvas(ctx, fixture(t, "gps.jpg")); !errors.Is(err, imaging.ErrBusy) {
		t.Errorf("with every slot taken: %v", err)
	}
}
