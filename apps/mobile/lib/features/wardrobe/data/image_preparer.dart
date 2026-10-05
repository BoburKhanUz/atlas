import 'package:flutter/foundation.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';

import 'image_probe.dart';
import 'jpeg_sanitizer.dart';

/// The backend's limits (docs/api/openapi.json, POST /api/v1/wardrobe/items)
/// and this app's stricter preparation targets. The backend stays the final
/// authority; these never relax it.
abstract final class UploadLimits {
  static const minShortestSide = 256;
  static const maxLongestSide = 4096; // app target (backend allows 8000)
  static const maxBytes = 8 * 1024 * 1024;
  static const qualities = [90, 85, 80, 75];
}

/// Re-encodes an image to JPEG on the device (platform codec). Implemented
/// with flutter_image_compress; tests use fakes.
abstract interface class ImageCompressor {
  /// [targetShortestSide]: scale down (never up) so that the shorter side is
  /// at most this; null keeps the size. Must apply the EXIF orientation to
  /// the pixels and must not copy metadata.
  Future<Uint8List> toJpeg(Uint8List source, {required int quality, int? targetShortestSide});
}

class PlatformImageCompressor implements ImageCompressor {
  const PlatformImageCompressor();

  @override
  Future<Uint8List> toJpeg(Uint8List source, {required int quality, int? targetShortestSide}) {
    // flutter_image_compress scales so that the shorter side reaches
    // min(minWidth, minHeight) (never upscales); equal values make that
    // independent of orientation. Platform default is 1920.
    final side = targetShortestSide ?? 1 << 20;
    return FlutterImageCompress.compressWithList(
      source,
      minWidth: side,
      minHeight: side,
      quality: quality,
      format: CompressFormat.jpeg,
      autoCorrectionAngle: true, // bake the EXIF rotation into the pixels
      keepExif: false, // never copy EXIF/GPS (also stripped again below)
    );
  }
}

enum PreparationError {
  /// Not an image the device can read.
  unreadable,

  /// Shortest side under 256 px (backend IMAGE_DIMENSIONS).
  tooSmall,

  /// Still over 8 MB at the lowest quality.
  tooLarge,

  /// The encoder did not apply the orientation (fail closed).
  orientation,
}

class ImagePreparationException implements Exception {
  const ImagePreparationException(this.error);
  final PreparationError error;
  @override
  String toString() => 'ImagePreparationException(${error.name})';
}

/// The upload body: JPEG bytes (metadata-free), the file name sent with them
/// and the pixel size. Lives in memory only; never logged ([toString]).
@immutable
class PreparedImage {
  const PreparedImage({required this.bytes, required this.filename, required this.width, required this.height});
  final Uint8List bytes;
  final String filename;
  final int width;
  final int height;

  @override
  String toString() => 'PreparedImage(${width}x$height, ${bytes.length} bytes)';
}

/// Turns whatever the camera or gallery returned (JPEG, PNG, WebP, HEIC/HEIF,
/// AVIF…) into an upload the backend accepts:
/// JPEG · orientation applied · longest side ≤ 4096 · shortest ≥ 256 ·
/// ≤ 8 MB · no EXIF/GPS/XMP/ICC/comments. Every output of the platform
/// encoder is re-checked here (fail closed).
class ImagePreparer {
  const ImagePreparer(this._compressor);
  final ImageCompressor _compressor;

  Future<PreparedImage> prepare(Uint8List source, {String? originalName}) async {
    final probe = ImageProbe.inspect(source);
    if (probe.format == ImageFormat.unknown) throw const ImagePreparationException(PreparationError.unreadable);
    final shortest = probe.shortestSide;
    if (shortest != null && shortest < UploadLimits.minShortestSide) {
      throw const ImagePreparationException(PreparationError.tooSmall);
    }

    for (final quality in UploadLimits.qualities) {
      var out = await _encode(source, quality, _targetShortest(probe));
      var info = JpegStructure.parse(out);
      if (_longest(info) > UploadLimits.maxLongestSide) {
        // The source size was unknown or the encoder rounded up: one more
        // pass on our own (already oriented, metadata-free) output.
        final again = ImageProbe(format: ImageFormat.jpeg, width: info.width, height: info.height);
        out = await _encode(out, quality, _targetShortest(again));
        info = JpegStructure.parse(out);
        if (_longest(info) > UploadLimits.maxLongestSide) {
          throw const ImagePreparationException(PreparationError.unreadable);
        }
      }
      if (_shortest(info) < UploadLimits.minShortestSide) {
        throw const ImagePreparationException(PreparationError.tooSmall);
      }
      _checkOrientation(probe, info);
      if (out.length <= UploadLimits.maxBytes) {
        return PreparedImage(
          bytes: out,
          filename: uploadFileName(originalName),
          width: info.width,
          height: info.height,
        );
      }
    }
    throw const ImagePreparationException(PreparationError.tooLarge);
  }

  Future<Uint8List> _encode(Uint8List source, int quality, int? targetShortest) async {
    final Uint8List encoded;
    try {
      encoded = await _compressor.toJpeg(source, quality: quality, targetShortestSide: targetShortest);
    } on Object {
      throw const ImagePreparationException(PreparationError.unreadable);
    }
    try {
      return JpegSanitizer.strip(encoded); // also proves it is a complete JPEG
    } on FormatException {
      throw const ImagePreparationException(PreparationError.unreadable);
    }
  }

  /// Target for the shorter side so that the longer one ends ≤ 4096.
  static int? _targetShortest(ImageProbe p) {
    final longest = p.longestSide;
    final shortest = p.shortestSide;
    if (longest == null || shortest == null) return UploadLimits.maxLongestSide;
    if (longest <= UploadLimits.maxLongestSide) return null;
    return (shortest * UploadLimits.maxLongestSide / longest).floor();
  }

  static int _longest(JpegStructure s) => s.width > s.height ? s.width : s.height;
  static int _shortest(JpegStructure s) => s.width < s.height ? s.width : s.height;

  /// A JPEG source whose EXIF orientation swaps the axes (5–8) must come out
  /// with its width and height swapped; otherwise the platform encoder did
  /// not rotate the pixels and the photo would be stored sideways.
  static void _checkOrientation(ImageProbe source, JpegStructure out) {
    final w = source.width;
    final h = source.height;
    if (source.format != ImageFormat.jpeg || w == null || h == null || w == h) return;
    final sourceLandscape = w > h;
    final outLandscape = out.width > out.height;
    if (out.width == out.height) return;
    final expectedLandscape = source.swapsAxes ? !sourceLandscape : sourceLandscape;
    if (outLandscape != expectedLandscape) throw const ImagePreparationException(PreparationError.orientation);
  }

  /// The multipart file name: the picked name without its extension (a
  /// detection hint for the backend), letters/digits/_-/. only, ".jpg".
  static String uploadFileName(String? original) {
    var base = (original ?? '').split(RegExp(r'[/\\]')).last;
    final dot = base.lastIndexOf('.');
    if (dot > 0) base = base.substring(0, dot);
    base = base.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_').replaceAll(RegExp('_+'), '_');
    if (base.isEmpty || base == '_') base = 'photo';
    if (base.length > 80) base = base.substring(0, 80);
    return '$base.jpg';
  }
}
