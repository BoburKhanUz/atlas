package imaging_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"testing"
)

// tiffWithOrientation is an EXIF TIFF structure, in either byte order,
// whose IFD0 holds an unrelated tag and then the orientation.
func tiffWithOrientation(order binary.ByteOrder, orientation uint16) []byte {
	var b bytes.Buffer
	if order == binary.BigEndian {
		b.WriteString("MM")
	} else {
		b.WriteString("II")
	}
	w := func(v any) { _ = binary.Write(&b, order, v) }
	w(uint16(42))
	w(uint32(8)) // IFD0 right after the header
	w(uint16(2)) // two entries
	// ImageWidth (0x0100), LONG, 1, 300
	w(uint16(0x0100))
	w(uint16(4))
	w(uint32(1))
	w(uint32(300))
	// Orientation (0x0112), SHORT, 1, value in the first two bytes
	w(uint16(0x0112))
	w(uint16(3))
	w(uint32(1))
	w(orientation)
	w(uint16(0))
	w(uint32(0)) // no next IFD
	return b.Bytes()
}

// withJPEGEXIF puts an APP1 Exif segment right after the SOI of a JPEG.
func withJPEGEXIF(jpeg, tiff []byte) []byte {
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	out := append([]byte{}, jpeg[:2]...)
	out = append(out, seg...)
	out = append(out, payload...)
	return append(out, jpeg[2:]...)
}

// chunk is one RIFF chunk, padded to an even size.
func chunk(kind string, data []byte) []byte {
	out := append([]byte(kind), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(data)))
	out = append(out, data...)
	if len(data)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

// withWebPEXIF rebuilds a simple (VP8L) WebP as an extended one: VP8X, the
// image, an unknown chunk of odd length, then EXIF.
func withWebPEXIF(t *testing.T, webp, tiff []byte) []byte {
	t.Helper()
	if string(webp[12:16]) != "VP8L" {
		t.Fatalf("fixture is %q, want a VP8L WebP", webp[12:16])
	}
	image := webp[12:]
	// VP8X: flags (EXIF bit 0x08), reserved, canvas width-1 and height-1 (24 bits each).
	vp8x := make([]byte, 10)
	vp8x[0] = 0x08
	put24 := func(at, v int) { vp8x[at], vp8x[at+1], vp8x[at+2] = byte(v), byte(v>>8), byte(v>>16) }
	put24(4, 300-1)
	put24(7, 400-1)
	body := append([]byte("WEBP"), chunk("VP8X", vp8x)...)
	body = append(body, image...)
	body = append(body, chunk("ZZZZ", []byte{1, 2, 3})...) // odd length: padded
	body = append(body, chunk("EXIF", tiff)...)
	out := append([]byte("RIFF"), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

// Orientation read from EXIF in either byte order, and from a WebP whose
// EXIF chunk follows a chunk of odd length: the picture comes out turned.
func TestOrientationFromEveryKindOfEXIF(t *testing.T) {
	t.Parallel()
	for name, data := range map[string][]byte{
		"JPEG, big-endian EXIF":    withJPEGEXIF(fixture(t, "marked-progressive.jpg"), tiffWithOrientation(binary.BigEndian, 6)),
		"JPEG, little-endian EXIF": withJPEGEXIF(fixture(t, "marked-progressive.jpg"), tiffWithOrientation(binary.LittleEndian, 6)),
		"WebP, after an odd chunk": withWebPEXIF(t, fixture(t, "marked-lossless.webp"), tiffWithOrientation(binary.BigEndian, 6)),
	} {
		v, err := processor.Process(context.Background(), data)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if v.Width != 400 || v.Height != 300 {
			t.Errorf("%s: %dx%d, want 400x300 (turned)", name, v.Width, v.Height)
		}
		if corner := redCorner(decode(t, "webp", v.Display)); corner != "top-right" {
			t.Errorf("%s: the red quarter is %s, want top-right", name, corner)
		}
	}
	// A tag that is out of range, or a broken structure, leaves the picture as it is.
	for name, tiff := range map[string][]byte{
		"orientation 9": tiffWithOrientation(binary.LittleEndian, 9),
		"orientation 0": tiffWithOrientation(binary.LittleEndian, 0),
		"cut short":     tiffWithOrientation(binary.LittleEndian, 6)[:12],
		"not TIFF":      []byte("XX*\x00\x08\x00\x00\x00"),
		"IFD past end":  append([]byte("II*\x00"), 0xff, 0xff, 0, 0),
		"empty":         nil,
		"not a SHORT": func() []byte {
			t := tiffWithOrientation(binary.LittleEndian, 6)
			binary.LittleEndian.PutUint16(t[24:], 4) // the orientation entry's type: LONG
			return t
		}(),
	} {
		v, err := processor.Process(context.Background(), withJPEGEXIF(fixture(t, "marked-progressive.jpg"), tiff))
		if err != nil || v.Width != 300 || v.Height != 400 {
			t.Errorf("%s: %v, %dx%d", name, err, v.Width, v.Height)
		}
	}
}
