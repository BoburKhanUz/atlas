import 'dart:typed_data';

import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';

import '../../support/jpeg_fixtures.dart';

/// Signed-URL signature values used in fixtures (assembled at runtime).
String sigFor(String id, String variant) => ['sig', id, variant, 'zz'].join('-');

Map<String, Object?> imageJsonFor(String id, {DateTime? expiresAt, bool relative = false}) {
  final base = relative ? '' : 'http://api.test';
  return {
    'id': 'img-$id',
    'url': '$base/api/v1/media/users/u1/${id}_display.webp?exp=1790000000&sig=${sigFor(id, 'd')}',
    'thumbnailUrl': '$base/api/v1/media/users/u1/${id}_thumb.webp?exp=1790000000&sig=${sigFor(id, 't')}',
    'urlExpiresAt': (expiresAt ?? DateTime.now().toUtc().add(const Duration(hours: 1))).toIso8601String(),
    'isPrimary': true,
    'width': 1600,
    'height': 2133,
  };
}

/// Confidences as the mock vision returns them: most attributes low.
const lowConfidences = <String, Object?>{
  'category': 0.31,
  'subcategory': 0.2,
  'color': 0.86,
  'pattern': 0.78,
  'material': 0.35,
  'style': 0.3,
  'season': 0.45,
  'sleeveLength': 0.15,
  'fit': 0.15,
  'formality': 0.3,
  'gender': 0.3,
};

Map<String, Object?> itemJson(
  String id, {
  String category = 'shirt',
  DateTime? expiresAt,
  bool corrected = false,
  Map<String, Object?>? confidences,
  List<Map<String, Object?>>? correctionLog,
}) => {
  'id': id,
  'category': category,
  'subcategory': category == 'shirt' ? 'tshirt' : null,
  'colors': ['white', 'navy'],
  'pattern': 'solid',
  'material': 'cotton',
  'sleeveLength': 'short',
  'fit': 'regular',
  'style': 'casual',
  'season': ['summer'],
  'gender': 'unisex',
  'formality': 'casual',
  'confidences': confidences ?? {'category': 0.92},
  'wasCorrected': corrected || (correctionLog?.isNotEmpty ?? false),
  'correctionLog':
      correctionLog ??
      (corrected
          ? [
              {'field': 'colors', 'from': '["white"]', 'to': '["white","navy"]', 'at': '2026-10-05T10:00:00.000Z'},
            ]
          : <Object>[]),
  'images': [imageJsonFor(id, expiresAt: expiresAt)],
  'primaryImage': imageJsonFor(id, expiresAt: expiresAt),
  'createdAt': '2026-10-05T10:00:00.000Z',
  'updatedAt': '2026-10-05T10:00:00.000Z',
};

Map<String, Object?> pageJson(List<String> ids, {String? next, String category = 'shirt'}) => {
  'items': [for (final id in ids) itemJson(id, category: category)],
  'nextCursor': next,
};

Map<String, Object?> uploadJson(String id, {Map<String, Object?>? confidences}) => {
  'item': itemJson(id, confidences: confidences),
  'detection': {
    'category': 'shirt',
    'subcategory': 'tshirt',
    'colors': ['white'],
    'pattern': 'solid',
    'material': 'cotton',
    'sleeveLength': 'short',
    'fit': null,
    'style': 'casual',
    'season': ['summer'],
    'gender': null,
    'formality': 'casual',
    'confidence': {'category': 0.92},
    'mock': true,
  },
};

/// The system picker stand-in.
class FakePicker implements PhotoPicker {
  FakePicker({this.result, this.denied = false, this.lost});
  PickedPhoto? result;
  bool denied;

  /// What `retrieveLostData` would deliver (Android process death).
  PickedPhoto? lost;
  final calls = <PhotoSource>[];

  /// `preferFront` of each call.
  final front = <bool>[];
  var lostCalls = 0;

  @override
  Future<PickedPhoto?> recoverLost() async {
    lostCalls++;
    final l = lost;
    lost = null;
    return l;
  }

  @override
  Future<PickedPhoto?> pick(PhotoSource source, {bool preferFront = false}) async {
    calls.add(source);
    front.add(preferFront);
    if (denied) throw PhotoAccessDenied(source);
    return result;
  }
}

/// The platform encoder stand-in: returns [output] (default: the landscape
/// fixture with device metadata, which the pipeline must strip).
class StubCompressor implements ImageCompressor {
  StubCompressor([this.output]);
  Uint8List? output;
  @override
  Future<Uint8List> toJpeg(Uint8List source, {required int quality, int? targetShortestSide}) async =>
      output ?? withDeviceMetadata(fixtureBytes('plain_landscape.jpg'));
}

PickedPhoto photo([String name = 'IMG_0042.HEIC']) => PickedPhoto(fixtureBytes('plain_landscape.jpg'), name);
