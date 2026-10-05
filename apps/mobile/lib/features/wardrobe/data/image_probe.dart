import 'dart:typed_data';

/// What the bytes are, judged by their signature (never by file name).
enum ImageFormat { jpeg, png, webp, heif, avif, gif, unknown }

/// Format, stored pixel size and EXIF orientation of an image, read from its
/// headers without decoding it.
class ImageProbe {
  const ImageProbe({required this.format, this.width, this.height, this.orientation = 1});

  final ImageFormat format;

  /// Stored (unrotated) size; null when the header could not be read.
  final int? width;
  final int? height;

  /// EXIF orientation 1–8 (JPEG only; 1 when absent).
  final int orientation;

  /// Orientations 5–8 swap width and height when displayed.
  bool get swapsAxes => orientation >= 5 && orientation <= 8;

  int? get shortestSide => width == null || height == null ? null : (width! < height! ? width : height);
  int? get longestSide => width == null || height == null ? null : (width! > height! ? width : height);

  static ImageProbe inspect(Uint8List b) {
    if (b.length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) {
      final info = JpegStructure.tryParse(b);
      return ImageProbe(
        format: ImageFormat.jpeg,
        width: info?.width,
        height: info?.height,
        orientation: info?.orientation ?? 1,
      );
    }
    if (b.length >= 24 && _ascii(b, 1, 3) == 'PNG' && b[0] == 0x89) {
      final d = ByteData.sublistView(b);
      return ImageProbe(format: ImageFormat.png, width: d.getUint32(16), height: d.getUint32(20));
    }
    if (b.length >= 30 && _ascii(b, 0, 4) == 'RIFF' && _ascii(b, 8, 4) == 'WEBP') {
      return _webp(b);
    }
    if (b.length >= 12 && _ascii(b, 4, 4) == 'ftyp') {
      final brands = _ascii(b, 8, (b.length < 64 ? b.length : 64) - 8);
      if (brands.contains('avif') || brands.contains('avis')) return _isobmff(b, ImageFormat.avif);
      if (RegExp('heic|heix|hevc|hevx|heim|heis|mif1|msf1').hasMatch(brands)) return _isobmff(b, ImageFormat.heif);
    }
    if (b.length >= 6 && _ascii(b, 0, 3) == 'GIF') return const ImageProbe(format: ImageFormat.gif);
    return const ImageProbe(format: ImageFormat.unknown);
  }

  static ImageProbe _webp(Uint8List b) {
    final d = ByteData.sublistView(b);
    final chunk = _ascii(b, 12, 4);
    int? w;
    int? h;
    if (chunk == 'VP8X') {
      w = 1 + (b[24] | b[25] << 8 | b[26] << 16);
      h = 1 + (b[27] | b[28] << 8 | b[29] << 16);
    } else if (chunk == 'VP8 ' && b.length >= 30) {
      w = d.getUint16(26, Endian.little) & 0x3FFF;
      h = d.getUint16(28, Endian.little) & 0x3FFF;
    } else if (chunk == 'VP8L' && b.length >= 25) {
      final bits = d.getUint32(21, Endian.little);
      w = (bits & 0x3FFF) + 1;
      h = ((bits >> 14) & 0x3FFF) + 1;
    }
    return ImageProbe(format: ImageFormat.webp, width: w, height: h);
  }

  /// HEIF/AVIF: the first `ispe` (image spatial extents) box gives the size.
  static ImageProbe _isobmff(Uint8List b, ImageFormat format) {
    for (var i = 4; i + 16 <= b.length && i < 1 << 20; i++) {
      if (b[i] == 0x69 && b[i + 1] == 0x73 && b[i + 2] == 0x70 && b[i + 3] == 0x65) {
        final d = ByteData.sublistView(b);
        return ImageProbe(format: format, width: d.getUint32(i + 8), height: d.getUint32(i + 12));
      }
    }
    return ImageProbe(format: format);
  }

  static String _ascii(Uint8List b, int start, int length) =>
      String.fromCharCodes(b.sublist(start, (start + length).clamp(0, b.length)));
}

/// One marker segment of a JPEG header.
class JpegSegment {
  const JpegSegment(this.marker, this.start, this.end);

  /// Marker byte after 0xFF (e.g. 0xE1 = APP1).
  final int marker;

  /// Byte range of the whole segment including the marker.
  final int start;
  final int end;
}

/// The marker structure of a JPEG (header segments, scans, EOI).
class JpegStructure {
  JpegStructure._(this.segments, this.width, this.height, this.orientation, this.eoiEnd);

  final List<JpegSegment> segments;
  final int width;
  final int height;
  final int orientation;

  /// Offset just after the EOI marker.
  final int eoiEnd;

  static JpegStructure? tryParse(Uint8List b) {
    try {
      return parse(b);
    } on FormatException {
      return null;
    }
  }

  /// Walks every segment up to EOI (progressive JPEGs have several scans).
  /// Throws [FormatException] when the bytes are not a complete JPEG.
  static JpegStructure parse(Uint8List b) {
    if (b.length < 4 || b[0] != 0xFF || b[1] != 0xD8) throw const FormatException('not a JPEG');
    final segments = <JpegSegment>[];
    int? width;
    int? height;
    var orientation = 1;
    var i = 2;
    while (i < b.length) {
      if (b[i] != 0xFF) throw const FormatException('marker expected');
      while (i < b.length && b[i] == 0xFF) {
        i++; // fill bytes
      }
      if (i >= b.length) break;
      final marker = b[i];
      final start = i - 1;
      i++;
      if (marker == 0xD9) {
        if (width == null || height == null) throw const FormatException('no frame header');
        return JpegStructure._(segments, width, height, orientation, i);
      }
      if (marker >= 0xD0 && marker <= 0xD7 || marker == 0x01) {
        segments.add(JpegSegment(marker, start, i));
        continue;
      }
      if (i + 2 > b.length) throw const FormatException('truncated');
      final length = b[i] << 8 | b[i + 1];
      if (length < 2 || i + length > b.length) throw const FormatException('bad segment length');
      final segEnd = i + length;
      final isSof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
      if (isSof) {
        if (length < 8) throw const FormatException('bad frame header');
        height = b[i + 3] << 8 | b[i + 4];
        width = b[i + 5] << 8 | b[i + 6];
        if (width == 0 || height == 0) throw const FormatException('empty frame');
      }
      if (marker == 0xE1) orientation = _exifOrientation(b, i + 2, segEnd) ?? orientation;
      segments.add(JpegSegment(marker, start, segEnd));
      i = segEnd;
      if (marker == 0xDA) {
        // Entropy-coded data: runs until the next marker that is not a
        // stuffed 0xFF00 or a restart marker.
        while (i + 1 < b.length) {
          if (b[i] == 0xFF && b[i + 1] != 0x00 && !(b[i + 1] >= 0xD0 && b[i + 1] <= 0xD7)) break;
          i++;
        }
        segments.add(JpegSegment(-1, segEnd, i)); // scan data
      }
    }
    throw const FormatException('no end of image');
  }

  /// Orientation (tag 0x0112 of IFD0) from an APP1 Exif payload.
  static int? _exifOrientation(Uint8List b, int start, int end) {
    if (end - start < 14 || String.fromCharCodes(b.sublist(start, start + 4)) != 'Exif') return null;
    final tiff = start + 6;
    final d = ByteData.sublistView(b);
    final Endian e;
    if (b[tiff] == 0x49 && b[tiff + 1] == 0x49) {
      e = Endian.little;
    } else if (b[tiff] == 0x4D && b[tiff + 1] == 0x4D) {
      e = Endian.big;
    } else {
      return null;
    }
    final ifd = tiff + d.getUint32(tiff + 4, e);
    if (ifd + 2 > end) return null;
    final count = d.getUint16(ifd, e);
    for (var k = 0; k < count; k++) {
      final entry = ifd + 2 + k * 12;
      if (entry + 12 > end) return null;
      if (d.getUint16(entry, e) == 0x0112) {
        final v = d.getUint16(entry + 8, e);
        return v >= 1 && v <= 8 ? v : null;
      }
    }
    return null;
  }
}
