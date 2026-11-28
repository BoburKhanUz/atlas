package imaging

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"

	xdraw "golang.org/x/image/draw"
)

// What a picture becomes for garment analysis by a vision model, as the
// Next.js server prepares it (apps/web/src/lib/ai/providers/vision-input.ts
// and color-analysis.ts). The resampling is this package's, not sharp's
// (ADR 0009): a picture at the very edge of a threshold can fall on the
// other side.
const (
	// MaxVisionSide is the largest longest side a model is sent.
	MaxVisionSide = 2048
	// maxVisionBytes bounds the JPEG sent inline (base64 makes it a third
	// larger).
	maxVisionBytes    = 4 << 20
	visionJPEGQuality = 85
	// canvasSide bounds the canvas the blur is measured on.
	canvasSide = 320
)

var (
	// The picture sent is laid on white: JPEG has no transparency, and black
	// would read as the garment's background colour.
	visionBackground = color.NRGBA{255, 255, 255, 255}
	// The canvas is laid on grey.
	canvasBackground = color.NRGBA{128, 128, 128, 255}
)

// ErrVisionTooLarge is a prepared picture larger than a model is sent.
var ErrVisionTooLarge = errors.New("imaging: the prepared picture exceeds the vision byte limit")

// VisionInput is a picture prepared for garment analysis.
type VisionInput struct {
	// JPEG is what may leave the server: upright, laid on white, its
	// longest side at most the one asked for (never enlarged), quality 85,
	// without any metadata.
	JPEG          []byte
	Width, Height int
	// Canvas is the upright picture within 320 pixels (never enlarged),
	// laid on grey, as rows of R, G, B bytes: what the blur is measured on.
	Canvas                    []byte
	CanvasWidth, CanvasHeight int
}

// PrepareVision prepares a picture for a vision model whose longest side
// is maxSide (1 to MaxVisionSide). It refuses what Process refuses, and
// waits for a slot as Process does.
func (p *Processor) PrepareVision(ctx context.Context, data []byte, maxSide int) (VisionInput, error) {
	if maxSide < 1 || maxSide > MaxVisionSide {
		return VisionInput{}, fmt.Errorf("imaging: a vision picture's longest side must be 1 to %d, not %d", MaxVisionSide, maxSide)
	}
	h, err := inspect(data, p.d)
	if err != nil {
		return VisionInput{}, err
	}
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return VisionInput{}, fmt.Errorf("%w: %w", ErrBusy, ctx.Err())
	}
	defer func() { <-p.slots }()
	src, err := guarded(func() (image.Image, error) { return p.d.pixels(h.format, data) })
	if err != nil {
		return VisionInput{}, unreadable(err)
	}
	if src.Bounds().Dx() != h.cfg.Width || src.Bounds().Dy() != h.cfg.Height {
		return VisionInput{}, ErrInvalid
	}
	upright := orient(src, h.orientation)

	sent := flatten(fitInside(upright, maxSide), visionBackground)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, sent, &jpeg.Options{Quality: visionJPEGQuality}); err != nil {
		return VisionInput{}, fmt.Errorf("imaging: encode the vision picture: %w", err)
	}
	if buf.Len() > maxVisionBytes {
		return VisionInput{}, ErrVisionTooLarge
	}
	canvas := flatten(fitInside(upright, canvasSide), canvasBackground)
	return VisionInput{
		JPEG: buf.Bytes(), Width: sent.Rect.Dx(), Height: sent.Rect.Dy(),
		Canvas: rgbOf(canvas), CanvasWidth: canvas.Rect.Dx(), CanvasHeight: canvas.Rect.Dy(),
	}, nil
}

// flatten lays a picture on an opaque background.
func flatten(src image.Image, background color.NRGBA) *image.RGBA {
	b := src.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), image.NewUniform(background), image.Point{}, draw.Src)
	draw.Draw(out, out.Bounds(), src, b.Min, draw.Over)
	return out
}

// rgbOf is an opaque picture's pixels as R, G, B bytes, row by row.
func rgbOf(img *image.RGBA) []byte {
	out := make([]byte, 0, img.Rect.Dx()*img.Rect.Dy()*3)
	for y := 0; y < img.Rect.Dy(); y++ {
		row := img.Pix[y*img.Stride : y*img.Stride+4*img.Rect.Dx()]
		for x := 0; x < len(row); x += 4 {
			out = append(out, row[x], row[x+1], row[x+2])
		}
	}
	return out
}

// CentreSample is the rectangle r of an encoded picture (JPEG, PNG or WebP,
// as stored: no orientation is applied) scaled to width×height, as R, G, B
// bytes with transparency dropped: what the colour check counts. A
// rectangle of that size is taken as it is.
func CentreSample(data []byte, r image.Rectangle, width, height int) ([]byte, error) {
	format, err := sniff(data)
	if err != nil {
		return nil, err
	}
	src, err := guarded(func() (image.Image, error) { return decode(format, data) })
	if err != nil {
		return nil, unreadable(err)
	}
	// A decoded picture's bounds start at 0, 0.
	b := src.Bounds()
	if r.Empty() || !r.In(b) || width < 1 || height < 1 {
		return nil, fmt.Errorf("imaging: %v is not inside a %d×%d picture", r, b.Dx(), b.Dy())
	}
	// Scaling a rectangle to its own size leaves its pixels as they are.
	out := image.NewNRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(out, out.Bounds(), src, r, xdraw.Src, nil)
	rgb := make([]byte, 0, width*height*3)
	for i := 0; i < len(out.Pix); i += 4 {
		rgb = append(rgb, out.Pix[i], out.Pix[i+1], out.Pix[i+2])
	}
	return rgb, nil
}
