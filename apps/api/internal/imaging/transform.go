package imaging

import (
	"image"
	"image/draw"

	xdraw "golang.org/x/image/draw"
)

// orient turns a picture upright for its EXIF orientation. Orientation 1 is
// the picture as decoded (its own pixel type kept: grey stays grey,
// 16 bits stay 16 bits in a PNG master).
func orient(src image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	in := toNRGBA(src)
	dw, dh := w, h
	if orientation >= 5 {
		dw, dh = h, w
	}
	out := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		row := in.Pix[y*in.Stride : y*in.Stride+4*w]
		for x := 0; x < w; x++ {
			var dx, dy int
			switch orientation {
			case 2: // mirrored
				dx, dy = w-1-x, y
			case 3: // upside down
				dx, dy = w-1-x, h-1-y
			case 4: // mirrored upside down
				dx, dy = x, h-1-y
			case 5: // transposed
				dx, dy = y, x
			case 6: // turned clockwise
				dx, dy = h-1-y, x
			case 7: // transversed
				dx, dy = h-1-y, w-1-x
			case 8: // turned anticlockwise
				dx, dy = y, w-1-x
			}
			copy(out.Pix[dy*out.Stride+4*dx:dy*out.Stride+4*dx+4], row[4*x:4*x+4])
		}
	}
	return out
}

func toNRGBA(src image.Image) *image.NRGBA {
	if n, ok := src.(*image.NRGBA); ok && n.Rect.Min == (image.Point{}) {
		return n
	}
	b := src.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), src, b.Min, draw.Src)
	return out
}

// fitInside scales the picture down to fit a square of side n (never up).
func fitInside(src image.Image, n int) image.Image {
	w, h := fitSize(src.Bounds().Dx(), src.Bounds().Dy(), n)
	return scaleTo(src, w, h)
}

// scaleTo returns the picture at the given size (itself when it has it).
func scaleTo(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	if w == b.Dx() && h == b.Dy() {
		return src
	}
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(out, out.Bounds(), src, b, xdraw.Src, nil)
	return out
}

// sample scales the picture's middle square to SampleSide×SampleSide and
// returns its pixels as R, G, B bytes, row by row. Transparency is dropped,
// not blended: a pixel counts as the colour stored for it.
func sample(src image.Image) []byte {
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	square := image.Rect(x0, y0, x0+side, y0+side)
	out := image.NewNRGBA(image.Rect(0, 0, SampleSide, SampleSide))
	xdraw.CatmullRom.Scale(out, out.Bounds(), src, square, xdraw.Src, nil)
	rgb := make([]byte, 0, SampleSide*SampleSide*3)
	for i := 0; i < len(out.Pix); i += 4 {
		rgb = append(rgb, out.Pix[i], out.Pix[i+1], out.Pix[i+2])
	}
	return rgb
}
