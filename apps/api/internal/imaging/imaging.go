// Package imaging turns an uploaded picture into the variants the wardrobe
// stores (ADR 0009): the master in its own format, a display WebP and a
// thumbnail WebP, upright and without metadata. The input is untrusted: its
// format is decided from its bytes, its size from its header before any
// pixel is decoded, and only memory-safe Go decoders read it.
package imaging

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"math"

	"github.com/gen2brain/webp"
	xwebp "golang.org/x/image/webp"
)

// The refusals, each an error code of the contract.
var (
	// ErrUnsupported: a format we recognise and do not accept (HEIC, HEIF,
	// AVIF, GIF, TIFF, SVG): UNSUPPORTED_IMAGE_FORMAT.
	ErrUnsupported = errors.New("imaging: unsupported image format")
	// ErrInvalid: bytes that are not a picture we can read: INVALID_IMAGE.
	ErrInvalid = errors.New("imaging: not a readable image")
	// ErrDimensions: a side or the pixel count out of bounds: IMAGE_DIMENSIONS.
	ErrDimensions = errors.New("imaging: image dimensions out of bounds")
)

// The limits, the Next.js server's (apps/web/src/lib/storage/provider.ts).
const (
	MinSide   = 256
	MaxSide   = 8000
	MaxPixels = 40_000_000

	DisplayMaxSide = 1600
	ThumbMaxSide   = 400

	masterJPEGQuality  = 92
	displayWebPQuality = 82
	thumbWebPQuality   = 75
)

// Format is an accepted format, decided from the bytes.
type Format struct {
	Name string // jpeg, png, webp
	Ext  string // of the master's key
	MIME string
}

var (
	jpegFormat = Format{"jpeg", "jpg", "image/jpeg"}
	pngFormat  = Format{"png", "png", "image/png"}
	webpFormat = Format{"webp", "webp", "image/webp"}
)

// Variants is a processed picture.
type Variants struct {
	// Width and Height of the master, upright.
	Width, Height int
	Ext, MIMEType string
	Master        []byte
	Display       []byte // WebP, at most DisplayMaxSide on its longer side
	Thumbnail     []byte // WebP, at most ThumbMaxSide on its longer side
	// Sample is the picture's middle square at SampleSide×SampleSide, as
	// rows of R, G, B bytes (transparency dropped): what the development
	// mock of garment analysis reads colours from.
	Sample []byte
}

// SampleSide is the side of Variants.Sample, in pixels.
const SampleSide = 32

// Processor processes pictures, at most n at a time: a decoded picture can
// take hundreds of megabytes.
type Processor struct{ slots chan struct{} }

// NewProcessor returns a Processor that works on at most n pictures at once.
func NewProcessor(n int) *Processor { return &Processor{slots: make(chan struct{}, max(n, 1))} }

// CheckEncoder fails when the WebP encoder would be a libwebp of the machine
// rather than the transpiled one this project ships (ADR 0009): a build
// without the `nodynamic` tag, run where libwebp is installed.
func CheckEncoder() error {
	if webp.Dynamic() == nil {
		return errors.New("imaging: a system libwebp is in use; build with -tags nodynamic")
	}
	return nil
}

// Process checks and converts one picture. The header is checked at once;
// a picture that passes waits for a free slot within ctx, so a refusal
// never waits behind other pictures. The refusals are ErrUnsupported,
// ErrInvalid and ErrDimensions; any other error is the server's.
func (p *Processor) Process(ctx context.Context, data []byte) (Variants, error) {
	h, err := inspect(data)
	if err != nil {
		return Variants{}, err
	}
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return Variants{}, ctx.Err()
	}
	defer func() { <-p.slots }()
	return render(data, h)
}

// Hold takes a slot until the returned function is called (tests).
func (p *Processor) Hold() func() {
	p.slots <- struct{}{}
	return func() { <-p.slots }
}

// header is what a picture's header says: read before any pixel is decoded.
type header struct {
	format      Format
	cfg         image.Config // as stored
	orientation int
	w, h        int // upright
}

// The decoders are the standard library's, but a picture is untrusted:
// should one of them fail in an unforeseen way, the upload is refused, the
// server goes on.
func refuseOnPanic(err *error) {
	if r := recover(); r != nil {
		*err = fmt.Errorf("%w (decoder panic)", ErrInvalid)
	}
}

// inspect reads the format, the dimensions and the orientation, and applies
// the limits: cheap, whatever the picture claims.
func inspect(data []byte) (h header, err error) {
	defer refuseOnPanic(&err)
	format, err := sniff(data)
	if err != nil {
		return header{}, err
	}
	cfg, err := decodeConfig(format, data)
	if err != nil {
		return header{}, ErrInvalid
	}
	h = header{format: format, cfg: cfg, orientation: orientationOf(format, data), w: cfg.Width, h: cfg.Height}
	if h.orientation >= 5 {
		h.w, h.h = h.h, h.w
	}
	if min(h.w, h.h) < MinSide || max(h.w, h.h) > MaxSide || h.w*h.h > MaxPixels {
		return header{}, ErrDimensions
	}
	return h, nil
}

// render decodes a picture inspect accepted and writes its variants.
func render(data []byte, hd header) (v Variants, err error) {
	defer refuseOnPanic(&err)
	format, cfg, orientation, w, h := hd.format, hd.cfg, hd.orientation, hd.w, hd.h
	src, err := decode(format, data)
	if err != nil {
		return Variants{}, ErrInvalid
	}
	if src.Bounds().Dx() != cfg.Width || src.Bounds().Dy() != cfg.Height {
		return Variants{}, ErrInvalid // the header and the pixels disagree
	}
	upright := orient(src, orientation)

	master, err := encodeMaster(format, upright)
	if err != nil {
		return Variants{}, fmt.Errorf("imaging: encode the master: %w", err)
	}
	display := fitInside(upright, DisplayMaxSide)
	displayBytes, err := encodeWebP(display, displayWebPQuality)
	if err != nil {
		return Variants{}, fmt.Errorf("imaging: encode the display variant: %w", err)
	}
	thumb := fitInside(display, ThumbMaxSide)
	if !display.Bounds().Eq(upright.Bounds()) && thumb.Bounds().Eq(display.Bounds()) {
		thumb = fitInside(upright, ThumbMaxSide)
	}
	thumbBytes, err := encodeWebP(thumb, thumbWebPQuality)
	if err != nil {
		return Variants{}, fmt.Errorf("imaging: encode the thumbnail: %w", err)
	}
	return Variants{
		Width: w, Height: h, Ext: format.Ext, MIMEType: format.MIME,
		Master: master, Display: displayBytes, Thumbnail: thumbBytes,
		Sample: sample(display),
	}, nil
}

func decodeConfig(f Format, data []byte) (image.Config, error) {
	r := bytes.NewReader(data)
	switch f.Name {
	case "jpeg":
		return jpeg.DecodeConfig(r)
	case "png":
		return png.DecodeConfig(r)
	default:
		return xwebp.DecodeConfig(r)
	}
}

func decode(f Format, data []byte) (image.Image, error) {
	r := bytes.NewReader(data)
	switch f.Name {
	case "jpeg":
		return jpeg.Decode(r)
	case "png":
		return png.Decode(r)
	default:
		return xwebp.Decode(r)
	}
}

// encodeMaster writes the upright picture in its own format. Re-encoding
// keeps no metadata: the encoders write none.
func encodeMaster(f Format, img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	var err error
	switch f.Name {
	case "jpeg":
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: masterJPEGQuality})
	case "png":
		err = png.Encode(&buf, img)
	default:
		err = webp.Encode(&buf, img, webp.Options{Lossless: true, Method: webp.DefaultMethod})
	}
	return buf.Bytes(), err
}

func encodeWebP(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	err := webp.Encode(&buf, img, webp.Options{Quality: quality, Method: webp.DefaultMethod})
	return buf.Bytes(), err
}

// fitSize is the size that fits inside a square of side n without
// enlarging, rounded as libvips rounds (half up).
func fitSize(w, h, n int) (int, int) {
	if w <= n && h <= n {
		return w, h
	}
	if w >= h {
		return n, max(1, int(math.Round(float64(h)*float64(n)/float64(w))))
	}
	return max(1, int(math.Round(float64(w)*float64(n)/float64(h)))), n
}
