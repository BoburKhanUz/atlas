package imaging

import (
	"bytes"
)

// heifBrands are the ISO-BMFF brands of HEIC, HEIF and AVIF files (iPhone
// photos among them): refused as unsupported even when nothing else of the
// file can be read, as the Next.js server refuses them.
var heifBrands = map[string]bool{
	"heic": true, "heix": true, "hevc": true, "hevx": true, "heim": true, "heis": true,
	"mif1": true, "msf1": true, "avif": true, "avis": true,
}

// sniff decides the format from the bytes. Formats the Next.js server's
// decoder recognised and refused are ErrUnsupported (415); anything else
// that is not one of the three is ErrInvalid (422).
func sniff(b []byte) (Format, error) {
	switch {
	case len(b) >= 12 && string(b[4:8]) == "ftyp" && heifBrands[string(b[8:12])]:
		return Format{}, ErrUnsupported
	case bytes.HasPrefix(b, []byte{0xff, 0xd8, 0xff}):
		return jpegFormat, nil
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return pngFormat, nil
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return webpFormat, nil
	case bytes.HasPrefix(b, []byte("GIF87a")), bytes.HasPrefix(b, []byte("GIF89a")),
		bytes.HasPrefix(b, []byte("II*\x00")), bytes.HasPrefix(b, []byte("MM\x00*")),
		isSVG(b):
		return Format{}, ErrUnsupported
	}
	return Format{}, ErrInvalid
}

// isSVG is libvips's test: "<svg" within the first kilobyte.
func isSVG(b []byte) bool {
	return bytes.Contains(b[:min(len(b), 1000)], []byte("<svg"))
}
