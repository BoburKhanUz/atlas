/// JSON bodies shaped exactly like docs/api/openapi.json responses.
Map<String, Object?> userJson() => {'id': 'u1', 'email': 'a@test.local', 'name': null};

Map<String, Object?> mobileAuthJson() => {
  'user': userJson(),
  'accessToken': 'acc.tok.en',
  'accessTokenExpiresAt': '2026-10-05T10:15:00.000Z',
  'refreshToken': 'refresh-token-value',
  'refreshTokenExpiresAt': '2026-11-04T10:00:00.000Z',
  'sessionExpiresAt': '2027-01-03T00:00:00.000Z',
};

Map<String, Object?> imageJson() => {
  'id': 'img-1',
  'url': 'http://api.test/api/v1/media/users/u1/a_display.webp?exp=1790000000&sig=abc',
  'thumbnailUrl': 'http://api.test/api/v1/media/users/u1/a_thumb.webp?exp=1790000000&sig=def',
  'urlExpiresAt': '2026-10-05T11:00:00.000Z',
  'isPrimary': true,
  'width': 1600,
  'height': 2133,
};

Map<String, Object?> wardrobeItemJson() => {
  'id': 'item-1',
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
  'confidences': {'category': 0.92},
  'wasCorrected': false,
  'correctionLog': <Object>[],
  'images': [imageJson()],
  'primaryImage': imageJson(),
  'createdAt': '2026-10-05T10:00:00.000Z',
  'updatedAt': '2026-10-05T10:00:00.000Z',
};

Map<String, Object?> wardrobeListJson() => {
  'items': [wardrobeItemJson()],
  'nextCursor': 'cursor-2',
};

Map<String, Object?> wardrobeUploadJson() => {
  'item': wardrobeItemJson(),
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
    'mock': true, // contract: const true
  },
};

Map<String, Object?> healthJson() => {'status': 'ok', 'database': 'ok', 'version': '0.2.1'};
