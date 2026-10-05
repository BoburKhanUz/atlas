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

Map<String, Object?> itemJson(String id, {String category = 'shirt', DateTime? expiresAt, bool corrected = false}) => {
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
  'confidences': {'category': 0.92},
  'wasCorrected': corrected,
  'correctionLog': corrected
      ? [
          {'field': 'colors', 'from': '["white"]', 'to': '["white","navy"]', 'at': '2026-10-05T10:00:00.000Z'},
        ]
      : <Object>[],
  'images': [imageJsonFor(id, expiresAt: expiresAt)],
  'primaryImage': imageJsonFor(id, expiresAt: expiresAt),
  'createdAt': '2026-10-05T10:00:00.000Z',
  'updatedAt': '2026-10-05T10:00:00.000Z',
};

Map<String, Object?> pageJson(List<String> ids, {String? next, String category = 'shirt'}) => {
  'items': [for (final id in ids) itemJson(id, category: category)],
  'nextCursor': next,
};

Map<String, Object?> uploadJson(String id) => {
  'item': itemJson(id),
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
  FakePicker({this.result, this.denied = false});
  PickedPhoto? result;
  bool denied;
  final calls = <PhotoSource>[];

  @override
  Future<PickedPhoto?> pick(PhotoSource source) async {
    calls.add(source);
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
