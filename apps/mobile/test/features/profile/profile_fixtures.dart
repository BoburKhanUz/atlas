Map<String, Object?> profileJson({
  String? name = 'Aziza',
  String email = 'a@test.local',
  List<String> preferredStyles = const ['casual'],
  List<String> dislikedStyles = const [],
  List<String> favoriteColors = const ['navy', 'white'],
  List<String> dislikedColors = const ['orange'],
  bool noPreferences = false,
}) => {
  'user': {
    'id': 'u1',
    'email': email,
    'name': name,
    'createdAt': '2026-10-01T00:00:00.000Z',
    'profile': null,
    'preferences': null,
  },
  // What the server really sends (all columns); the generated client keeps
  // only id/userId (ProfileRow).
  'profile': {'id': 'p1', 'userId': 'u1', 'gender': 'female', 'height': 168, 'preferredFit': 'slim'},
  'preferences': noPreferences
      ? null
      : {
          'language': 'uz',
          'preferredStyles': preferredStyles,
          'dislikedStyles': dislikedStyles,
          'favoriteColors': favoriteColors,
          'dislikedColors': dislikedColors,
        },
};

Map<String, Object?> patchResponseJson() => {
  'user': {'id': 'u1', 'email': 'a@test.local', 'name': 'Aziza', 'profile': null, 'preferences': null},
};

Map<String, Object?> notAnalysedJson() => {
  'status': 'not_analyzed',
  'colorProfile': null,
  'message': 'Rang tahlilisi hali amalga oshirilmadi. Selfie yuklang.',
};

Map<String, Object?> colorCore({String season = 'autumn', String analyzedAt = '2026-10-05T10:00:00.000Z'}) => {
  'id': 'cp1',
  'undertone': 'warm',
  'season': season,
  'contrastLevel': 'medium',
  'recommendedColors': ['olive', 'mustard', 'rust'],
  'neutralColors': ['beige', 'tan'],
  'cautionColors': ['white', 'pink'],
  'skinTone': 'tan',
  'hairColor': 'brown',
  'eyeColor': 'brown',
  'analyzedAt': analyzedAt,
};

const disclaimer = 'Bu AI tavsiyasi — tibbiy yoki ilmiy diagnosis emas. Faqat styling maqsadida.';

Map<String, Object?> analysedJson({String season = 'autumn', String analyzedAt = '2026-10-05T10:00:00.000Z'}) => {
  'status': 'analyzed',
  'colorProfile': colorCore(season: season, analyzedAt: analyzedAt),
  'disclaimer': disclaimer,
};

Map<String, Object?> analysisJson({num confidence = 0.82, String season = 'spring'}) => {
  'colorProfile': {...colorCore(season: season), 'confidence': confidence},
  'disclaimer': disclaimer,
};
