import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

/// Bytes of `test/fixtures/images/<name>`.
Uint8List fixtureBytes(String name) => File('test/fixtures/images/$name').readAsBytesSync();

/// A JPEG marker segment (0xFF, marker, length, payload).
Uint8List segment(int marker, List<int> payload) {
  final length = payload.length + 2;
  return Uint8List.fromList([0xFF, marker, length >> 8, length & 0xFF, ...payload]);
}

/// Device-style metadata inserted after SOI: EXIF (orientation + GPS
/// position), XMP, an ICC profile, a comment and data after EOI.
Uint8List withDeviceMetadata(
  Uint8List jpeg, {
  int? orientation,
  bool gps = true,
  bool xmp = true,
  bool icc = true,
  bool comment = true,
  bool trailer = true,
}) {
  final out = BytesBuilder()..add(jpeg.sublist(0, 2));
  out.add(segment(0xE1, exifPayload(orientation: orientation, gps: gps)));
  if (xmp) {
    out.add(
      segment(0xE1, [
        ...ascii.encode('http://ns.adobe.com/xap/1.0/'),
        0,
        ...utf8.encode('<x:xmpmeta><exif:GPSLatitude>41,18.5N</exif:GPSLatitude></x:xmpmeta>'),
      ]),
    );
  }
  if (icc) out.add(segment(0xE2, [...ascii.encode('ICC_PROFILE'), 0, 1, 1, ...List.filled(64, 7)]));
  if (comment) out.add(segment(0xFE, ascii.encode('Taken at home, Tashkent')));
  out.add(jpeg.sublist(2));
  if (trailer) out.add(ascii.encode('MPF-SECOND-IMAGE-GPS-41.3111,69.2797'));
  return out.toBytes();
}

/// Big-endian TIFF EXIF: IFD0 with Orientation and a GPS IFD pointer; GPS
/// IFD with latitude 41°18'40" N and longitude 69°16'47" E (Tashkent).
List<int> exifPayload({int? orientation, bool gps = true}) {
  final b = BytesBuilder();
  void u16(int v) => b.add([v >> 8 & 0xFF, v & 0xFF]);
  void u32(int v) => b.add([v >> 24 & 0xFF, v >> 16 & 0xFF, v >> 8 & 0xFF, v & 0xFF]);
  final entries = (orientation != null ? 1 : 0) + (gps ? 1 : 0);
  // TIFF header
  b.add(ascii.encode('MM'));
  u16(42);
  u32(8);
  // IFD0 at 8
  u16(entries);
  final gpsIfd = 8 + 2 + entries * 12 + 4;
  if (orientation != null) {
    u16(0x0112);
    u16(3);
    u32(1);
    u16(orientation);
    u16(0);
  }
  if (gps) {
    u16(0x8825);
    u16(4);
    u32(1);
    u32(gpsIfd);
  }
  u32(0);
  if (gps) {
    // GPS IFD: LatitudeRef, Latitude, LongitudeRef, Longitude
    final data = gpsIfd + 2 + 4 * 12 + 4;
    u16(4);
    u16(1); // GPSLatitudeRef
    u16(2);
    u32(2);
    b.add([0x4E, 0, 0, 0]); // "N"
    u16(2); // GPSLatitude
    u16(5);
    u32(3);
    u32(data);
    u16(3); // GPSLongitudeRef
    u16(2);
    u32(2);
    b.add([0x45, 0, 0, 0]); // "E"
    u16(4); // GPSLongitude
    u16(5);
    u32(3);
    u32(data + 24);
    u32(0);
    for (final (n, d) in [(41, 1), (18, 1), (40, 1), (69, 1), (16, 1), (47, 1)]) {
      u32(n);
      u32(d);
    }
  }
  return [...ascii.encode('Exif'), 0, 0, ...b.toBytes()];
}

/// The same JPEG with its frame header claiming another size (header-only
/// tests: the pixels are not decoded).
Uint8List withFrameSize(Uint8List jpeg, int width, int height) {
  final out = Uint8List.fromList(jpeg);
  for (var i = 2; i + 9 < out.length; i++) {
    if (out[i] == 0xFF && out[i + 1] >= 0xC0 && out[i + 1] <= 0xC2) {
      out[i + 5] = height >> 8;
      out[i + 6] = height & 0xFF;
      out[i + 7] = width >> 8;
      out[i + 8] = width & 0xFF;
      return out;
    }
  }
  throw StateError('no SOF');
}

/// Padding that survives sanitising (APP14 segments) to make a JPEG large.
Uint8List padded(Uint8List jpeg, int extraBytes) {
  final out = BytesBuilder()..add(jpeg.sublist(0, 2));
  var left = extraBytes;
  while (left > 0) {
    final n = left > 65000 ? 65000 : left;
    out.add(segment(0xEE, [...ascii.encode('Adobe'), ...List.filled(n, 0)]));
    left -= n + 9;
  }
  out.add(jpeg.sublist(2));
  return out.toBytes();
}

/// Decodes [bytes] with the engine's codec and returns RGBA of pixel (x, y).
Future<(int, int, int)> pixelAt(Uint8List bytes, int x, int y) async {
  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final image = frame.image;
  final data = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
  final o = (y * image.width + x) * 4;
  final rgb = (data.getUint8(o), data.getUint8(o + 1), data.getUint8(o + 2));
  image.dispose();
  return rgb;
}

Future<(int, int)> decodedSize(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final size = (frame.image.width, frame.image.height);
  frame.image.dispose();
  return size;
}

bool isRed((int, int, int) p) => p.$1 > 200 && p.$2 < 60 && p.$3 < 60;
bool isWhite((int, int, int) p) => p.$1 > 220 && p.$2 > 220 && p.$3 > 220;

/// Searches [haystack] for [needle] bytes.
bool containsBytes(Uint8List haystack, List<int> needle) {
  outer:
  for (var i = 0; i + needle.length <= haystack.length; i++) {
    for (var j = 0; j < needle.length; j++) {
      if (haystack[i + j] != needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
