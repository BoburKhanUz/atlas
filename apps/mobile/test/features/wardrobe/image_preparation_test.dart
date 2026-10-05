import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_probe.dart';
import 'package:atlas_mobile/features/wardrobe/data/jpeg_sanitizer.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/jpeg_fixtures.dart';

/// A platform encoder stand-in: records calls, returns scripted outputs.
class FakeCompressor implements ImageCompressor {
  FakeCompressor(this.respond);
  final Uint8List Function(Uint8List source, int quality, int? target, int call) respond;
  final calls = <({int quality, int? target})>[];

  @override
  Future<Uint8List> toJpeg(Uint8List source, {required int quality, int? targetShortestSide}) async {
    calls.add((quality: quality, target: targetShortestSide));
    return respond(source, quality, targetShortestSide, calls.length);
  }
}

final _gpsMarkers = [
  ascii.encode('Exif'),
  ascii.encode('GPS'),
  ascii.encode('ns.adobe.com/xap'),
  ascii.encode('Tashkent'),
  ascii.encode('ICC_PROFILE'),
  ascii.encode('MPF-SECOND'),
];

void expectNoMetadata(Uint8List jpeg) {
  expect(JpegSanitizer.hasMetadata(jpeg), isFalse);
  for (final m in _gpsMarkers) {
    expect(containsBytes(jpeg, m), isFalse, reason: 'found "${ascii.decode(m)}"');
  }
  // GPS rational 41/1 as stored in the EXIF (big-endian u32 pairs).
  expect(containsBytes(jpeg, [0, 0, 0, 41, 0, 0, 0, 1, 0, 0, 0, 18]), isFalse);
}

/// A HEIF file header without size information (decoders only learn it
/// from the image data).
final _heicWithoutSize = Uint8List.fromList([
  0,
  0,
  0,
  24,
  ...ascii.encode('ftypheic'),
  0,
  0,
  0,
  0,
  ...ascii.encode('mif1heic'),
  ...List.filled(64, 0),
]);

void main() {
  final landscape = fixtureBytes('plain_landscape.jpg');
  final rotatedReference = fixtureBytes('rotated_cw90_reference.jpg');

  group('probe', () {
    test('JPEG size and EXIF orientation', () {
      final p = ImageProbe.inspect(withDeviceMetadata(landscape, orientation: 6));
      expect((p.format, p.width, p.height, p.orientation, p.swapsAxes), (ImageFormat.jpeg, 640, 480, 6, true));
      expect(ImageProbe.inspect(landscape).orientation, 1);
    });
    test('PNG, HEIC, GIF and unknown are told apart by signature', () {
      expect(ImageProbe.inspect(fixtureBytes('plain.png')).format, ImageFormat.png);
      expect(ImageProbe.inspect(fixtureBytes('plain.png')).width, 640);
      final heic = ImageProbe.inspect(fixtureBytes('sample.heic'));
      expect((heic.format, heic.width, heic.height), (ImageFormat.heif, 300, 400));
      expect(ImageProbe.inspect(_heicWithoutSize).format, ImageFormat.heif);
      expect(ImageProbe.inspect(Uint8List.fromList(ascii.encode('GIF89a......'))).format, ImageFormat.gif);
      expect(ImageProbe.inspect(Uint8List.fromList(List.filled(32, 7))).format, ImageFormat.unknown);
    });
  });

  group('sanitizer: EXIF/GPS removal (lossless)', () {
    test('removes EXIF incl. GPS, XMP, ICC, comments and data after EOI', () {
      final dirty = withDeviceMetadata(landscape, orientation: 6);
      expect(JpegSanitizer.hasMetadata(dirty), isTrue);
      expect(containsBytes(dirty, ascii.encode('GPS')) || containsBytes(dirty, [0x88, 0x25]), isTrue);
      final clean = JpegSanitizer.strip(dirty);
      expectNoMetadata(clean);
      expect(ImageProbe.inspect(clean).orientation, 1, reason: 'no EXIF orientation left');
    });

    test('pixels are untouched: the clean file decodes to the same image', () async {
      final clean = JpegSanitizer.strip(withDeviceMetadata(landscape, orientation: 3));
      expect(await decodedSize(clean), (640, 480));
      expect(isRed(await pixelAt(clean, 20, 20)), isTrue);
      expect(isWhite(await pixelAt(clean, 400, 100)), isTrue);
    });

    test('keeps JFIF; idempotent; rejects truncated or non-JPEG data', () {
      final clean = JpegSanitizer.strip(landscape);
      expect(JpegSanitizer.strip(clean), clean);
      expect(
        () => JpegSanitizer.strip(Uint8List.sublistView(landscape, 0, landscape.length ~/ 2)),
        throwsFormatException,
      );
      expect(() => JpegSanitizer.strip(fixtureBytes('plain.png')), throwsFormatException);
      expect(() => JpegSanitizer.strip(fixtureBytes('sample.heic')), throwsFormatException);
    });
  });

  group('preparer', () {
    test('device photo with orientation 6 + GPS: correctly oriented JPEG, no metadata at all', () async {
      // A well-behaved encoder rotates — and (worst case) copies the EXIF.
      final c = FakeCompressor((src, q, t, n) => withDeviceMetadata(rotatedReference, orientation: 1));
      final out = await ImagePreparer(c)
          .prepare(withDeviceMetadata(landscape, orientation: 6), originalName: 'IMG_0001.HEIC');
      expect((out.width, out.height), (480, 640));
      expectNoMetadata(out.bytes);
      // Pixels: the red block (stored top-left) is displayed top-right.
      expect(await decodedSize(out.bytes), (480, 640));
      expect(isRed(await pixelAt(out.bytes, 460, 20)), isTrue);
      expect(isWhite(await pixelAt(out.bytes, 20, 20)), isTrue);
      expect(out.filename, 'IMG_0001.jpg');
      expect(c.calls.single, (quality: 90, target: null), reason: 'no downscale needed');
    });

    test('an encoder that ignores the orientation is rejected (fail closed)', () async {
      final c = FakeCompressor((src, q, t, n) => landscape);
      await expectLater(
        ImagePreparer(c).prepare(withDeviceMetadata(landscape, orientation: 6)),
        throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.orientation)),
      );
    });

    test('orientation 1 keeps the axes', () async {
      final c = FakeCompressor((src, q, t, n) => landscape);
      final out = await ImagePreparer(c).prepare(withDeviceMetadata(landscape, orientation: 1));
      expect((out.width, out.height), (640, 480));
    });

    test('HEIC input → valid JPEG (the encoder\'s output is verified as a complete JPEG)', () async {
      final c = FakeCompressor((src, q, t, n) => withDeviceMetadata(landscape));
      final out = await ImagePreparer(c).prepare(fixtureBytes('sample.heic'), originalName: 'IMG_7.HEIC');
      expect(JpegStructure.parse(out.bytes).width, 640);
      expectNoMetadata(out.bytes);
      expect(out.filename, 'IMG_7.jpg');
    });

    test('an encoder that returns HEIC/PNG instead of JPEG is rejected', () async {
      for (final wrong in [fixtureBytes('sample.heic'), fixtureBytes('plain.png')]) {
        final c = FakeCompressor((src, q, t, n) => wrong);
        await expectLater(
          ImagePreparer(c).prepare(fixtureBytes('sample.heic')),
          throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.unreadable)),
        );
      }
    });

    test('shortest side < 256 is rejected before encoding', () async {
      final c = FakeCompressor((src, q, t, n) => src);
      await expectLater(
        ImagePreparer(c).prepare(fixtureBytes('tiny.jpg')),
        throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.tooSmall)),
      );
      expect(c.calls, isEmpty);
    });

    test('… and after encoding too (unknown source size)', () async {
      final c = FakeCompressor((src, q, t, n) => fixtureBytes('tiny.jpg'));
      await expectLater(
        ImagePreparer(c).prepare(_heicWithoutSize),
        throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.tooSmall)),
      );
    });

    test('longest side is capped at 4096 (8000×6000 → shorter side 3072)', () async {
      final big = withFrameSize(landscape, 8000, 6000);
      final c = FakeCompressor((src, q, t, n) => withFrameSize(landscape, 4096, 3072));
      final out = await ImagePreparer(c).prepare(big);
      expect(c.calls.single.target, 3072);
      expect((out.width, out.height), (4096, 3072));
    });

    test('encoder output still over 4096 → one more pass on that output', () async {
      final c = FakeCompressor(
        (src, q, t, n) => n == 1 ? withFrameSize(landscape, 5000, 3000) : withFrameSize(landscape, 4096, 2457),
      );
      final out = await ImagePreparer(c).prepare(_heicWithoutSize);
      expect(c.calls.map((x) => x.target), [4096, 2457]);
      expect(out.width, 4096);
    });

    test('over 8 MB → lower quality steps; output ≤ 8 MB', () async {
      final c = FakeCompressor((src, q, t, n) => q > 80 ? padded(landscape, 9 * 1024 * 1024) : landscape);
      final out = await ImagePreparer(c).prepare(landscape);
      expect(c.calls.map((x) => x.quality), [90, 85, 80]);
      expect(out.bytes.length, lessThanOrEqualTo(UploadLimits.maxBytes));
    });

    test('still over 8 MB at the lowest quality → tooLarge', () async {
      final c = FakeCompressor((src, q, t, n) => padded(landscape, 9 * 1024 * 1024));
      await expectLater(
        ImagePreparer(c).prepare(landscape),
        throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.tooLarge)),
      );
      expect(c.calls.map((x) => x.quality), UploadLimits.qualities);
    });

    test('unreadable input or an encoder failure → unreadable', () async {
      final ok = FakeCompressor((src, q, t, n) => landscape);
      await expectLater(
        ImagePreparer(ok).prepare(Uint8List.fromList(List.filled(100, 1))),
        throwsA(isA<ImagePreparationException>()),
      );
      final failing = FakeCompressor((src, q, t, n) => throw StateError('codec'));
      await expectLater(
        ImagePreparer(failing).prepare(landscape),
        throwsA(isA<ImagePreparationException>().having((e) => e.error, 'error', PreparationError.unreadable)),
      );
    });

    test('file names: base name kept as a hint, safe characters, always .jpg', () {
      expect(ImagePreparer.uploadFileName('IMG_1234.HEIC'), 'IMG_1234.jpg');
      expect(ImagePreparer.uploadFileName('/data/user/0/cache/image_picker123.png'), 'image_picker123.jpg');
      expect(ImagePreparer.uploadFileName('ko‘ylak rasm.jpeg'), 'ko_ylak_rasm.jpg');
      expect(ImagePreparer.uploadFileName(null), 'photo.jpg');
      expect(ImagePreparer.uploadFileName('${'a' * 200}.jpg').length, 84);
    });

    test('PreparedImage never prints its bytes', () async {
      final out = await ImagePreparer(FakeCompressor((src, q, t, n) => landscape)).prepare(landscape);
      expect(out.toString(), 'PreparedImage(640x480, ${out.bytes.length} bytes)');
    });
  });
}
