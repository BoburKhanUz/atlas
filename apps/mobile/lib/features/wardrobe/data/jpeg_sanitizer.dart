import 'dart:typed_data';

import 'image_probe.dart';

/// Removes every metadata segment from a JPEG, losslessly (pixels are not
/// re-encoded):
/// * APP1 (EXIF incl. GPS, XMP), APP2 (ICC, MPF/"Ultra HDR" gain maps),
///   APP3–APP13, APP15 and COM segments are dropped;
/// * APP0 (JFIF) and APP14 (Adobe colour transform, needed to decode) stay;
/// * anything after EOI (appended images, trailers) is dropped.
///
/// The result is checked again: it must parse as a complete JPEG and contain
/// no metadata segment. This is the guarantee that no EXIF/GPS from the
/// device reaches the backend, whatever the platform encoder did.
abstract final class JpegSanitizer {
  static const _kept = {0xE0, 0xEE};

  static bool _isMetadata(int marker) =>
      (marker >= 0xE0 && marker <= 0xEF && !_kept.contains(marker)) || marker == 0xFE;

  /// Throws [FormatException] when [jpeg] is not a complete JPEG.
  static Uint8List strip(Uint8List jpeg) {
    final s = JpegStructure.parse(jpeg);
    final out = BytesBuilder(copy: false)..add(const [0xFF, 0xD8]);
    for (final seg in s.segments) {
      if (seg.marker >= 0 && _isMetadata(seg.marker)) continue;
      out.add(Uint8List.sublistView(jpeg, seg.start, seg.end));
    }
    out.add(const [0xFF, 0xD9]);
    final result = out.toBytes();
    if (hasMetadata(result)) throw StateError('metadata survived sanitising');
    return result;
  }

  /// True when [jpeg] contains any metadata segment [strip] would remove.
  static bool hasMetadata(Uint8List jpeg) {
    final s = JpegStructure.parse(jpeg);
    return s.segments.any((seg) => seg.marker >= 0 && _isMetadata(seg.marker)) || s.eoiEnd != jpeg.length;
  }
}
