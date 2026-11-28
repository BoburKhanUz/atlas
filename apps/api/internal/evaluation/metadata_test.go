package evaluation

import (
	"context"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/imaging"
)

// withSegment is a JPEG with one more header segment right after its start.
func withSegment(jpeg []byte, marker byte, body string) []byte {
	n := len(body) + 2
	out := append([]byte{}, jpeg[:2]...)
	out = append(out, 0xFF, marker, byte(n>>8), byte(n))
	out = append(out, body...)
	return append(out, jpeg[2:]...)
}

func TestAJPEGsMetadataIsSeenAndThePreparedPictureHasNone(t *testing.T) {
	t.Parallel()
	gps := golden.TestdataFile(t, "images/gps.jpg")
	plain := golden.TestdataFile(t, "images/marked-progressive.jpg")
	for _, c := range []struct {
		name string
		data []byte
		want bool
	}{
		{"a photo with GPS in its EXIF", gps, true},
		{"a photo without metadata", plain, false},
		{"with XMP", withSegment(plain, 0xE1, "http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>"), true},
		{"with IPTC", withSegment(plain, 0xED, "Photoshop 3.0\x008BIM"), true},
		{"with another APP1", withSegment(plain, 0xE1, "Other\x00"), false},
		{"not a JPEG", golden.TestdataFile(t, "images/marked.png"), false},
		{"empty", nil, false},
		{"cut short", gps[:20], false},
	} {
		if got := jpegHasMetadata(c.data); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
	for name, data := range map[string][]byte{"gps": gps, "xmp": withSegment(plain, 0xE1, "http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>")} {
		prepared, err := imaging.NewProcessor(1).PrepareVision(context.Background(), data, 512)
		if err != nil {
			t.Fatal(err)
		}
		if jpegHasMetadata(prepared.JPEG) {
			t.Errorf("%s: the prepared picture keeps metadata", name)
		}
	}
}
