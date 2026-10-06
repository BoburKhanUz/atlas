import 'dart:convert';
import 'dart:io';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_answers.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/profile/data/profile_data.dart' show ProfileLimits;
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _patchSchema() {
  final doc = jsonDecode(File('../../docs/api/openapi.json').readAsStringSync()) as Map<String, Object?>;
  return ((doc['components']! as Map)['schemas']! as Map)['ProfilePatchRequest']! as Map<String, Object?>;
}

List<String> _enumAt(Map<String, Object?> schema, List<String> path) {
  Object? node = schema;
  for (final key in path) {
    node = (node! as Map)[key];
  }
  final n = node! as Map;
  if (n['items'] != null) return ((n['items']! as Map)['enum']! as List).cast<String>();
  final anyOf = (n['anyOf']! as List).cast<Map<String, Object?>>();
  return (anyOf.firstWhere((m) => m['enum'] != null)['enum']! as List).cast<String>();
}

void main() {
  group('options match the contract enums exactly', () {
    final schema = _patchSchema();
    test('styles', () {
      for (final field in ['preferredStyles', 'dislikedStyles']) {
        expect(
          StyleOption.values.map((o) => o.wire).toSet(),
          _enumAt(schema, ['properties', 'preferences', 'properties', field]).toSet(),
        );
      }
    });
    test('colours', () {
      for (final field in ['favoriteColors', 'dislikedColors']) {
        expect(
          ColorOption.values.map((o) => o.wire).toSet(),
          _enumAt(schema, ['properties', 'preferences', 'properties', field]).toSet(),
        );
      }
    });
    test('gender and fit', () {
      expect(
        GenderOption.values.map((o) => o.wire).toSet(),
        _enumAt(schema, ['properties', 'profile', 'properties', 'gender']).toSet(),
      );
      expect(
        FitOption.values.map((o) => o.wire).toSet(),
        _enumAt(schema, ['properties', 'profile', 'properties', 'preferredFit']).toSet(),
      );
    });
    test('every label is non-empty and unique per option set', () {
      for (final labels in [
        StyleOption.values.map((o) => o.label),
        ColorOption.values.map((o) => o.label),
        GenderOption.values.map((o) => o.label),
        FitOption.values.map((o) => o.label),
      ]) {
        expect(labels.every((l) => l.trim().isNotEmpty), isTrue);
        expect(labels.toSet().length, labels.length);
      }
    });
  });

  group('PATCH body', () {
    test('nothing chosen → no body at all', () {
      expect(const OnboardingAnswers().toPatchJson(), isNull);
      expect(const OnboardingAnswers().isEmpty, isTrue);
    });

    test('only the chosen fields; empty lists and unset fields are omitted', () {
      final a = const OnboardingAnswers().togglePreferredStyle(StyleOption.minimal);
      expect(a.toPatchJson(), {
        'preferences': {
          'preferredStyles': ['minimal'],
        },
      });
      final b = const OnboardingAnswers().withFit(FitOption.relaxed);
      expect(b.toPatchJson(), {
        'profile': {'preferredFit': 'relaxed'},
      });
    });

    test('everything chosen → contract wire values in a deterministic order', () {
      var a = const OnboardingAnswers();
      a = a.togglePreferredStyle(StyleOption.streetwear).togglePreferredStyle(StyleOption.smartCasual);
      a = a.toggleDislikedStyle(StyleOption.formal);
      a = a.toggleFavoriteColor(ColorOption.navy).toggleFavoriteColor(ColorOption.lightBlue);
      a = a.toggleDislikedColor(ColorOption.mustard);
      a = a.withGender(GenderOption.female).withFit(FitOption.oversized);
      expect(a.toPatchJson(), {
        'preferences': {
          'preferredStyles': ['smart_casual', 'streetwear'],
          'dislikedStyles': ['formal'],
          'favoriteColors': ['navy', 'light_blue'],
          'dislikedColors': ['mustard'],
        },
        'profile': {'gender': 'female', 'preferredFit': 'oversized'},
      });
    });

    test('the body deserialises into the generated request with no unknown enum values', () {
      var a = const OnboardingAnswers();
      for (final s in StyleOption.values.take(5)) {
        a = a.togglePreferredStyle(s);
      }
      for (final s in StyleOption.values.skip(5)) {
        a = a.toggleDislikedStyle(s);
      }
      for (final c in ColorOption.values.take(12)) {
        a = a.toggleFavoriteColor(c);
      }
      for (final c in ColorOption.values.skip(12)) {
        a = a.toggleDislikedColor(c);
      }
      a = a.withGender(GenderOption.other).withFit(FitOption.slim);
      final json = a.toPatchJson()!;
      final request = standardSerializers.deserializeWith(ProfilePatchRequest.serializer, json)!;
      expect(request.preferences!.preferredStyles!.map((e) => e.name), isNot(contains('unknownDefaultOpenApi')));
      expect(request.preferences!.dislikedColors!.map((e) => e.name), isNot(contains('unknownDefaultOpenApi')));
      expect(request.profile!.gender, ProfilePatchRequestProfileGenderEnum.other);
      // Serialised again it is the same JSON (nothing added, nothing lost).
      expect(standardSerializers.serializeWith(ProfilePatchRequest.serializer, request), json);
    });
  });

  group('list limit (ProfileLimits.listMax = 20, shared with Profile)', () {
    final colors = ColorOption.values;
    OnboardingAnswers favourites(int n) {
      var a = const OnboardingAnswers();
      for (final c in colors.take(n)) {
        a = a.toggleFavoriteColor(c);
      }
      return a;
    }

    test('there are more colour options than the limit (the limit is reachable)', () {
      expect(ProfileLimits.listMax, 20);
      expect(colors.length, greaterThan(ProfileLimits.listMax));
    });

    test('20 favourite colours are accepted; the 21st is ignored and nothing else changes', () {
      final twenty = favourites(20);
      expect(twenty.favoriteColors, colors.take(20).toSet());
      final after = twenty.toggleFavoriteColor(colors[20]);
      expect(after, twenty);
      expect(after.favoriteColors, hasLength(20));
    });

    test('a full list never takes a colour away from the other list', () {
      final a = favourites(20).toggleDislikedColor(colors.last);
      expect(a.dislikedColors, {colors.last});
      // colors.last is disliked; liking it would make favourites 21 → refused,
      // and the dislike is preserved.
      final b = a.toggleFavoriteColor(colors.last);
      expect(b, a);
      expect(b.dislikedColors, {colors.last});
    });

    test('disliked colours are capped the same way', () {
      var a = const OnboardingAnswers();
      for (final c in colors) {
        a = a.toggleDislikedColor(c);
      }
      expect(a.dislikedColors, colors.take(20).toSet());
    });

    test('at the limit a selected colour can still be removed, then another added', () {
      final a = favourites(20).toggleFavoriteColor(colors[0]).toggleFavoriteColor(colors[20]);
      expect(a.favoriteColors, hasLength(20));
      expect(a.favoriteColors, contains(colors[20]));
      expect(a.favoriteColors, isNot(contains(colors[0])));
    });

    test('the PATCH body never carries more than 20 values per list, however the answers were built', () {
      final all = OnboardingAnswers(
        favoriteColors: colors.toSet(),
        dislikedColors: colors.toSet(),
        preferredStyles: StyleOption.values.toSet(),
      );
      final prefs = all.toPatchJson()!['preferences']! as Map<String, Object?>;
      expect((prefs['favoriteColors']! as List), hasLength(20));
      expect((prefs['dislikedColors']! as List), hasLength(20));
      expect((prefs['favoriteColors']! as List), [for (final c in colors.take(20)) c.wire]);
      expect((prefs['preferredStyles']! as List), hasLength(StyleOption.values.length));
    });
  });

  group('choices', () {
    test('a style is liked or disliked, never both', () {
      final a = const OnboardingAnswers()
          .togglePreferredStyle(StyleOption.casual)
          .toggleDislikedStyle(StyleOption.casual);
      expect(a.preferredStyles, isEmpty);
      expect(a.dislikedStyles, {StyleOption.casual});
    });

    test('a colour is liked or disliked, never both', () {
      final a = const OnboardingAnswers().toggleDislikedColor(ColorOption.red).toggleFavoriteColor(ColorOption.red);
      expect(a.favoriteColors, {ColorOption.red});
      expect(a.dislikedColors, isEmpty);
    });

    test('tapping a selected single choice clears it', () {
      final a = const OnboardingAnswers().withGender(GenderOption.male).withGender(GenderOption.male);
      expect(a.gender, isNull);
      expect(a.toPatchJson(), isNull);
    });

    test('clearing a step drops only that step', () {
      final a = const OnboardingAnswers()
          .togglePreferredStyle(StyleOption.classic)
          .toggleFavoriteColor(ColorOption.black)
          .withFit(FitOption.regular);
      expect(a.clearStyles().toPatchJson(), {
        'preferences': {
          'favoriteColors': ['black'],
        },
        'profile': {'preferredFit': 'regular'},
      });
      expect(a.clearProfile().toPatchJson()!.containsKey('profile'), isFalse);
      expect(a.clearColors().toPatchJson(), {
        'preferences': {
          'preferredStyles': ['classic'],
        },
        'profile': {'preferredFit': 'regular'},
      });
    });

    test('toString never reveals answers', () {
      final a = const OnboardingAnswers().withGender(GenderOption.female).togglePreferredStyle(StyleOption.preppy);
      expect(a.toString(), isNot(contains('female')));
      expect(a.toString(), isNot(contains('preppy')));
    });
  });
}
