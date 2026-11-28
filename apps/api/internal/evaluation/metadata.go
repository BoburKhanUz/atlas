package evaluation

import (
	"bytes"
	"encoding/binary"
)

// jpegHasMetadata says whether a JPEG carries an EXIF or XMP block (APP1)
// or an IPTC one (APP13), reading only the segment markers before the
// image data. A file that is no JPEG has none.
func jpegHasMetadata(data []byte) bool {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return false
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return false
		}
		marker := data[i+1]
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 { // image data, or the end: no more headers
			return false
		}
		length := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if length < 2 || i+2+length > len(data) {
			return false
		}
		body := data[i+4 : i+2+length]
		switch {
		case marker == 0xE1 && (bytes.HasPrefix(body, []byte("Exif\x00")) || bytes.HasPrefix(body, []byte("http://ns.adobe.com/xap/"))):
			return true
		case marker == 0xED && bytes.HasPrefix(body, []byte("Photoshop 3.0")):
			return true
		}
		i += 2 + length
	}
	return false
}
