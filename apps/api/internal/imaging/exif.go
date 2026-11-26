package imaging

import (
	"bytes"
	"encoding/binary"
)

// orientationOf reads the EXIF orientation (1 to 8) of a picture: from the
// JPEG APP1 segment, the WebP EXIF chunk or the PNG eXIf chunk. Anything it
// cannot read is 1 (as it is): a wrong or missing tag never refuses a
// picture.
func orientationOf(f Format, data []byte) int {
	var tiff []byte
	switch f.Name {
	case "jpeg":
		tiff = jpegEXIF(data)
	case "png":
		tiff = pngEXIF(data)
	default:
		tiff = webpEXIF(data)
	}
	if o := tiffOrientation(tiff); o >= 1 && o <= 8 {
		return o
	}
	return 1
}

var exifHeader = []byte("Exif\x00\x00")

// jpegEXIF walks the segments before the image data for APP1 "Exif".
func jpegEXIF(b []byte) []byte {
	i := 2 // after SOI
	for i+4 <= len(b) {
		if b[i] != 0xff {
			return nil
		}
		marker := b[i+1]
		if marker == 0xff { // fill byte
			i++
			continue
		}
		if marker == 0xda || marker == 0xd9 { // start of scan, end of image
			return nil
		}
		if marker >= 0xd0 && marker <= 0xd7 || marker == 0x01 { // no length
			i += 2
			continue
		}
		length := int(binary.BigEndian.Uint16(b[i+2:]))
		if length < 2 || i+2+length > len(b) {
			return nil
		}
		segment := b[i+4 : i+2+length]
		if marker == 0xe1 && bytes.HasPrefix(segment, exifHeader) {
			return segment[len(exifHeader):]
		}
		i += 2 + length
	}
	return nil
}

// pngEXIF finds the eXIf chunk.
func pngEXIF(b []byte) []byte {
	i := 8
	for i+12 <= len(b) {
		length := int(binary.BigEndian.Uint32(b[i:]))
		if length < 0 || length > len(b)-i-12 {
			return nil
		}
		kind := string(b[i+4 : i+8])
		if kind == "eXIf" {
			return bytes.TrimPrefix(b[i+8:i+8+length], exifHeader)
		}
		if kind == "IDAT" || kind == "IEND" {
			return nil
		}
		i += 12 + length
	}
	return nil
}

// webpEXIF finds the EXIF chunk of a RIFF WEBP file.
func webpEXIF(b []byte) []byte {
	i := 12
	for i+8 <= len(b) {
		length := int(binary.LittleEndian.Uint32(b[i+4:]))
		if length < 0 || length > len(b)-i-8 {
			return nil
		}
		if string(b[i:i+4]) == "EXIF" {
			return bytes.TrimPrefix(b[i+8:i+8+length], exifHeader)
		}
		i += 8 + length + length%2 // chunks are padded to even sizes
	}
	return nil
}

// tiffOrientation reads tag 0x0112 of IFD0 of a TIFF structure (EXIF).
func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	if order.Uint16(t[2:]) != 42 {
		return 0
	}
	ifd := int(order.Uint32(t[4:]))
	if ifd < 8 || ifd+2 > len(t) {
		return 0
	}
	n := int(order.Uint16(t[ifd:]))
	for k := 0; k < n; k++ {
		e := ifd + 2 + 12*k
		if e+12 > len(t) {
			return 0
		}
		if order.Uint16(t[e:]) == 0x0112 && order.Uint16(t[e+2:]) == 3 { // SHORT
			return int(order.Uint16(t[e+8:]))
		}
	}
	return 0
}
