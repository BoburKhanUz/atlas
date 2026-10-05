import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/profile/data/profile_data.dart';
import 'package:flutter_test/flutter_test.dart';

ProfileData original({String? name = 'Aziza'}) => ProfileData(
  email: 'a@test.local',
  name: name,
  preferredStyles: const {StyleOption.casual},
  favoriteColors: const {ColorOption.navy, ColorOption.white},
  dislikedColors: const {ColorOption.orange},
);

void main() {
  group('PATCH diff', () {
    test('nothing changed → no body', () {
      expect(original().toDraft().patchFrom(original()), isNull);
    });

    test('toggling back and forth is no change', () {
      final d = original().toDraft().toggleFavoriteColor(ColorOption.red).toggleFavoriteColor(ColorOption.red);
      expect(d.patchFrom(original()), isNull);
    });

    test('only the changed list is sent, in option order', () {
      final d = original().toDraft().toggleFavoriteColor(ColorOption.black);
      expect(d.patchFrom(original()), {
        'preferences': {
          'favoriteColors': ['white', 'black', 'navy'],
        },
      });
    });

    test('name: trimmed; unchanged whitespace is no change', () {
      expect(original().toDraft().withName('  Aziza  ').patchFrom(original()), isNull);
      expect(original().toDraft().withName('  Dilnoza ').patchFrom(original()), {'name': 'Dilnoza'});
    });

    test('an emptied list is sent as [] (allowed by the contract)', () {
      final d = original().toDraft().toggleDislikedColor(ColorOption.orange);
      expect(d.patchFrom(original()), {
        'preferences': {'dislikedColors': <String>[]},
      });
    });

    test('name and lists together; body fields never sent (gender, fit, height…)', () {
      final d = original().toDraft().withName('Dilnoza').togglePreferredStyle(StyleOption.minimal);
      final body = d.patchFrom(original())!;
      expect(body.keys.toSet(), {'name', 'preferences'});
      expect(body.containsKey('profile'), isFalse);
    });
  });

  group('validation', () {
    test('name 1–60 after trimming; cannot be cleared once set', () {
      expect(original().toDraft().withName('   ').problem, ProfileProblem.nameEmpty);
      expect(original().toDraft().withName('a' * 61).problem, ProfileProblem.nameTooLong);
      expect(original().toDraft().withName('a' * 60).problem, isNull);
      expect(original().toDraft().withName('  ${'a' * 60}  ').problem, isNull);
    });

    test('no name on the server: empty stays allowed (and is not sent)', () {
      final d = original(name: null).toDraft().togglePreferredStyle(StyleOption.formal);
      expect(d.problem, isNull);
      expect(d.patchFrom(original(name: null))!.containsKey('name'), isFalse);
    });

    test('at most 20 per list: the 21st is ignored', () {
      var d = original().toDraft();
      for (final c in ColorOption.values) {
        d = d.toggleFavoriteColor(c);
      }
      expect(d.favoriteColors.length, lessThanOrEqualTo(ProfileLimits.listMax));
      expect(d.problem, isNull);
    });

    test('liked and disliked are exclusive', () {
      final d = original().toDraft().toggleDislikedColor(ColorOption.navy);
      expect(d.dislikedColors, contains(ColorOption.navy));
      expect(d.favoriteColors, isNot(contains(ColorOption.navy)));
      final e = d.toggleFavoriteColor(ColorOption.navy);
      expect(e.dislikedColors, isNot(contains(ColorOption.navy)));
      final s = original().toDraft().toggleDislikedStyle(StyleOption.casual);
      expect(s.preferredStyles, isEmpty);
    });

    test('descriptions never print values', () {
      expect(original().toString(), isNot(contains('Aziza')));
      expect(original().toDraft().toString(), isNot(contains('Aziza')));
    });
  });
}
