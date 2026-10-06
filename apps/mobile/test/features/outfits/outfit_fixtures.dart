// Contract-shaped JSON for weather and outfits.

/// GET /api/v1/weather/current body.
Map<String, Object?> weatherJson({
  DateTime? fetchedAt,
  num temperature = 18,
  String condition = 'cloudy',
  bool cached = false,
}) => {
  'weather': {
    'temperature': temperature,
    'feelsLike': temperature - 1,
    'condition': condition,
    'conditionLabel': 'Bulutli',
    'precipitationProbability': 20,
    'precipitationAmount': 0,
    'humidity': 55,
    'windSpeed': 12,
    'uvIndex': 3,
    'source': 'mock',
    'fetchedAt': (fetchedAt ?? DateTime.utc(2026, 10, 5, 10)).toIso8601String(),
    'cached': cached,
  },
};

Map<String, Object?> weatherUsedJson({num temperature = 18, String condition = 'cloudy'}) => {
  'temperature': temperature,
  'feelsLike': temperature - 1,
  'condition': condition,
  'precipitationProbability': 20,
  'humidity': 55,
  'windSpeed': 12,
  'uvIndex': 3,
};

String sigOf(String itemId) => ['sig', itemId, 'gen', 'zz'].join('-');

Map<String, Object?> candidateJson(
  String tempId, {
  List<String> itemIds = const ['top1', 'bottom1', 'shoes1'],
  num score = 82.4,
  String? explanation,
}) => {
  'tempId': tempId,
  'score': score,
  'factors': {
    'weather': 0.9,
    'color': 0.8,
    'occasion': 0.7,
    'style': 0.6,
    'season': 0.8,
    'balance': 0.7,
    'preference': 0.5,
    'feedback': 0.5,
  },
  'reasons': ['weather', 'color_harmony'],
  'reasonLabels': ['Ob-havoga mos', 'Ranglar uyg‘un'],
  'contrastLevel': 'medium',
  'items': [
    for (final (i, id) in itemIds.indexed)
      {
        'id': id,
        'role': const ['top', 'bottom', 'shoes', 'accessory'][i % 4],
        'layeringRole': const ['top', 'bottom', 'footwear', 'accessory'][i % 4],
        'category': const ['shirt', 'pants', 'shoes', 'accessory'][i % 4],
        'subcategory': const ['tshirt', 'jeans', 'sneakers', 'belt'][i % 4],
        'colors': ['white'],
        'style': 'casual',
        'material': null,
        'season': ['summer'],
        'imageUrl': '/api/v1/media/users/u1/${id}_thumb.webp?exp=4102444800&sig=${sigOf(id)}',
      },
  ],
  'explanation': explanation,
};

Map<String, Object?> generateJson({
  List<Map<String, Object?>>? outfits,
  Map<String, Object?>? weatherUsed,
  String? occasion,
  int wardrobeItemCount = 6,
  String? message,
  bool fallback = true,
}) => {
  'outfits':
      outfits ??
      [
        candidateJson('t1', explanation: 'Bugun salqin, shuning uchun…'),
        candidateJson('t2', itemIds: const ['top2', 'bottom1', 'shoes1']),
      ],
  'weatherUsed': weatherUsed,
  'occasion': occasion,
  'wardrobeItemCount': wardrobeItemCount,
  'fallback': fallback,
  'message': ?message,
};

Map<String, Object?> emptyWardrobeJson() => generateJson(
  outfits: const [],
  weatherUsed: null,
  wardrobeItemCount: 0,
  message: 'Garderobingiz bo‘sh. Avval kiyim qo‘shing.',
);

Map<String, Object?> saveResponseJson(String id, {bool isSaved = true}) => {
  'outfit': {
    'id': id,
    'name': null,
    'occasion': null,
    'score': 82,
    'explanation': null,
    'isSaved': isSaved,
    'createdAt': '2026-10-05T10:00:00.000Z',
    'updatedAt': '2026-10-05T10:00:00.000Z',
    'items': [
      {'id': 'oi1', 'wardrobeItemId': 'top1', 'role': 'top'},
    ],
  },
};

Map<String, Object?> imageObject(String id) => {
  'id': 'img-$id',
  'url': '/api/v1/media/users/u1/$id.webp?exp=4102444800&sig=${sigOf(id)}',
  'thumbnailUrl': '/api/v1/media/users/u1/${id}_thumb.webp?exp=4102444800&sig=${sigOf(id)}',
  'urlExpiresAt': '2100-01-01T00:00:00.000Z',
  'isPrimary': true,
  'width': 1200,
  'height': 1600,
};

/// An `OutfitSummary` (list item). [items] are (wardrobe item id, role).
Map<String, Object?> summaryJson(
  String id, {
  bool isSaved = true,
  DateTime? createdAt,
  List<(String, String)> items = const [('top1', 'top'), ('bottom1', 'bottom'), ('shoes1', 'shoes')],
  int? score = 82,
  List<String> reasons = const ['Ob-havoga mos', 'Ranglar uyg‘un'],
  String? explanation = 'Bugun salqin, shuning uchun…',
  String? occasion,
  String? name,
  Map<String, Object?> weatherSnapshot = const {},
}) => {
  'id': id,
  'name': name,
  'occasion': occasion,
  'score': score,
  'reasons': reasons,
  'explanation': explanation,
  'isSaved': isSaved,
  'weatherSnapshot': weatherSnapshot,
  'createdAt': (createdAt ?? DateTime.utc(2026, 10, 5, 10)).toIso8601String(),
  'items': [
    for (final (itemId, role) in items)
      {
        'id': itemId,
        'role': role,
        'category': 'shirt',
        'subcategory': 'tshirt',
        'colors': ['white'],
        'style': 'casual',
        'material': null,
        'season': ['summer'],
        'image': imageObject(itemId),
      },
  ],
};

Map<String, Object?> listJson(List<Map<String, Object?>> outfits) => {'outfits': outfits};

Map<String, Object?> detailJson(String id, {String? name, bool isSaved = true}) => {
  'outfit': {
    'id': id,
    'name': name,
    'occasion': 'work',
    'score': 82,
    'explanation': 'Bugun salqin.',
    'isSaved': isSaved,
    'createdAt': '2026-10-05T10:00:00.000Z',
    'updatedAt': '2026-10-05T10:00:00.000Z',
    'reasons': ['Ob-havoga mos'],
    'weatherSnapshot': weatherUsedJson(),
    'items': [
      {
        'id': 'oi1',
        'role': 'top',
        'wardrobeItemId': 'top1',
        'item': {
          'id': 'top1',
          'category': 'shirt',
          'subcategory': 'tshirt',
          'colors': ['white'],
          'style': 'casual',
          'material': null,
          'season': ['summer'],
          'images': [imageObject('top1')],
        },
      },
    ],
  },
};

Map<String, Object?> rowJson(String id, {String? name, bool isSaved = true}) => {
  'outfit': {
    'id': id,
    'name': name,
    'occasion': 'work',
    'score': 82,
    'explanation': null,
    'isSaved': isSaved,
    'createdAt': '2026-10-05T10:00:00.000Z',
    'updatedAt': '2026-10-05T11:00:00.000Z',
  },
};

Map<String, Object?> feedbackJson(String outfitId, String kind) => {
  'feedback': {
    'id': 'f1',
    'outfitId': outfitId,
    'feedback': kind,
    'note': null,
    'createdAt': '2026-10-05T10:00:00.000Z',
  },
};

/// RFC 7231 date for the `Date` header.
String httpDate(DateTime t) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final u = t.toUtc();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${days[u.weekday - 1]}, ${two(u.day)} ${months[u.month - 1]} ${u.year} ${two(u.hour)}:${two(u.minute)}:${two(u.second)} GMT';
}
