import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/data/item_edit.dart';
import 'package:atlas_mobile/features/wardrobe/data/sha256.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_catalog.dart';
import 'package:built_collection/built_collection.dart';
import 'package:flutter_test/flutter_test.dart';

import 'wardrobe_fixtures.dart';

WardrobeItem item({Map<String, Object?>? confidences, List<Map<String, Object?>>? log}) => standardSerializers
    .deserializeWith(WardrobeItem.serializer, itemJson('i1', confidences: confidences, correctionLog: log))!;

Map<String, Object?> _contractEnumsOf(String schema) {
  final doc = jsonDecode(File('../../docs/api/openapi.json').readAsStringSync()) as Map<String, Object?>;
  final props = ((((doc['components']! as Map)['schemas']! as Map)[schema]! as Map)['properties']! as Map)
      .cast<String, Object?>();
  List<String>? values(Object? node) {
    final n = node! as Map;
    if (n['enum'] != null) return (n['enum']! as List).cast<String>();
    if (n['items'] != null) return values(n['items']);
    if (n['anyOf'] != null) {
      for (final a in n['anyOf']! as List) {
        final v = values(a);
        if (v != null) return v;
      }
    }
    return null;
  }

  return {for (final e in props.entries) e.key: values(e.value)};
}

void main() {
  group('confidence thresholds (exact boundaries)', () {
    for (final (value, level) in [
      (1.0, ConfidenceLevel.high),
      (0.70, ConfidenceLevel.high),
      (0.6999, ConfidenceLevel.medium),
      (0.40, ConfidenceLevel.medium),
      (0.3999, ConfidenceLevel.low),
      (0.0, ConfidenceLevel.low),
    ]) {
      test('$value → ${level.name}', () => expect(ConfidenceRules.levelOf(value), level));
    }
    test('the thresholds are the web client\'s 0.70 / 0.40', () {
      expect((ConfidenceRules.high, ConfidenceRules.medium), (0.70, 0.40));
    });
  });

  group('confidence keys', () {
    test('every server key maps to its attribute; "color" → colors', () {
      expect(ItemAttribute.fromConfidenceKey('color'), ItemAttribute.colors);
      expect(ItemAttribute.fromConfidenceKey('colors'), isNull);
      expect(
        lowConfidences.keys.map(ItemAttribute.fromConfidenceKey).toSet(),
        ItemAttribute.values.toSet(),
        reason: 'the 11 keys of the backend mock vision',
      );
    });

    test('unknown keys are ignored', () {
      final levels = confidenceLevels(BuiltMap<String, num>({'category': 0.1, 'sparkle': 0.01, 'colors': 0.0}));
      expect(levels, {ItemAttribute.category: ConfidenceLevel.low});
    });

    test('to review: low and not corrected and not acknowledged', () {
      final i = item(confidences: lowConfidences);
      expect(attributesToReview(i), {
        ItemAttribute.category,
        ItemAttribute.subcategory,
        ItemAttribute.material,
        ItemAttribute.style,
        ItemAttribute.sleeveLength,
        ItemAttribute.fit,
        ItemAttribute.formality,
        ItemAttribute.gender,
      });
      expect(attributesToReview(i), isNot(contains(ItemAttribute.season)), reason: '0.45 is medium');
      expect(attributesToReview(i), isNot(contains(ItemAttribute.colors)), reason: 'color 0.86 is high');
      final corrected = item(
        confidences: lowConfidences,
        log: [
          {'field': 'fit', 'from': 'regular', 'to': 'slim', 'at': '2026-10-05T10:00:00.000Z'},
        ],
      );
      expect(attributesToReview(corrected), isNot(contains(ItemAttribute.fit)));
      expect(attributesToReview(i, acknowledged: {ItemAttribute.gender}), isNot(contains(ItemAttribute.gender)));
      expect(needsReview(item()), isFalse, reason: 'category 0.92 only');
    });

    test('acknowledging never changes the item (server data)', () {
      final i = item(confidences: lowConfidences);
      final before = standardSerializers.serializeWith(WardrobeItem.serializer, i);
      attributesToReview(i, acknowledged: ItemAttribute.values.toSet());
      expect(standardSerializers.serializeWith(WardrobeItem.serializer, i), before);
    });
  });

  group('catalogue (decision D: the backend\'s own grouping)', () {
    test('category → subcategory grouping equals apps/web/src/lib/ai/catalog.ts SUBCATEGORIES exactly', () {
      final source = File('../web/src/lib/ai/catalog.ts').readAsStringSync();
      final block = source.substring(source.indexOf('export const SUBCATEGORIES'), source.indexOf('// ─── Colors'));
      final parsed = <String, List<String>>{};
      String? current;
      for (final line in const LineSplitter().convert(block)) {
        final cat = RegExp(r'^\s{2}(\w+): \[').firstMatch(line);
        if (cat != null) current = parsed[cat[1]!] == null ? cat[1] : current;
        if (cat != null) parsed[cat[1]!] = [];
        final id = RegExp(r"\{ id: '(\w+)'").firstMatch(line);
        if (id != null && current != null) parsed[current]!.add(id[1]!);
      }
      expect(parsed, WardrobeCatalog.subcategories);
    });

    test('categories and subcategories equal the contract enums; each subcategory in one category', () {
      final enums = _contractEnumsOf('WardrobeItemPatchRequest');
      expect(WardrobeCatalog.categories.toSet(), (enums['category']! as List).toSet());
      final all = WardrobeCatalog.subcategories.values.expand((x) => x).toList();
      expect(all.toSet(), (enums['subcategory']! as List).toSet());
      expect(all.length, all.toSet().length, reason: 'no subcategory in two categories');
    });

    test('every option list equals its contract enum', () {
      final enums = _contractEnumsOf('WardrobeItemPatchRequest');
      expect(WardrobeCatalog.colors.toSet(), (enums['colors']! as List).toSet());
      expect(WardrobeCatalog.patterns.toSet(), (enums['pattern']! as List).toSet());
      expect(WardrobeCatalog.materials.toSet(), (enums['material']! as List).toSet());
      expect(WardrobeCatalog.sleeveLengths.toSet(), (enums['sleeveLength']! as List).toSet());
      expect(WardrobeCatalog.fits.toSet(), (enums['fit']! as List).toSet());
      expect(WardrobeCatalog.styles.toSet(), (enums['style']! as List).toSet());
      expect(WardrobeCatalog.seasons.toSet(), (enums['season']! as List).toSet());
      expect(WardrobeCatalog.genders.toSet(), (enums['gender']! as List).toSet());
      expect(WardrobeCatalog.formalities.toSet(), (enums['formality']! as List).toSet());
    });
  });

  group('edit diff and PATCH body', () {
    final original = item();

    test('no change → no body (no request)', () {
      expect(ItemDraft.of(original).patchFrom(original), isNull);
    });

    test('a value set to its current value is no change', () {
      expect(ItemDraft.of(original).withValue(ItemAttribute.fit, 'regular').patchFrom(original), isNull);
    });

    test('lists compare as sets: reordering is no change', () {
      final d = ItemDraft.of(original).withValue(ItemAttribute.colors, ['navy', 'white']);
      expect(d.changesFrom(original), isEmpty);
      expect(d.patchFrom(original), isNull);
      // Same elements, different count (a duplicate) is a change.
      final dup = ItemDraft.of(original).withValue(ItemAttribute.colors, ['white', 'navy', 'white']);
      expect(dup.changesFrom(original), {ItemAttribute.colors});
    });

    test('only the changed fields are sent, in contract wire values', () {
      final d = ItemDraft.of(original)
          .withValue(ItemAttribute.fit, 'oversized')
          .withValue(ItemAttribute.colors, ['white', 'navy', 'light_blue'])
          .withValue(ItemAttribute.season, ['summer', 'spring']);
      expect(d.patchFrom(original), {
        'colors': ['white', 'navy', 'light_blue'],
        'season': ['summer', 'spring'],
        'fit': 'oversized',
      });
    });

    test('category change keeps only a matching subcategory; otherwise a subcategory must be chosen', () {
      final d = ItemDraft.of(original).withValue(ItemAttribute.category, 'shoes');
      expect(d.subcategory, isNull);
      expect(d.problem, EditProblem.subcategoryMissing);
      final ok = d.withValue(ItemAttribute.subcategory, 'sneakers');
      expect(ok.problem, isNull);
      expect(ok.patchFrom(original), {'category': 'shoes', 'subcategory': 'sneakers'});
    });

    test('limits: colors 1–5, season 1–4 (no clearing)', () {
      final base = ItemDraft.of(original);
      expect(base.withValue(ItemAttribute.colors, <String>[]).problem, EditProblem.colorsEmpty);
      expect(
        base.withValue(ItemAttribute.colors, WardrobeCatalog.colors.take(6).toList()).problem,
        EditProblem.tooManyColors,
      );
      expect(base.withValue(ItemAttribute.colors, WardrobeCatalog.colors.take(5).toList()).problem, isNull);
      expect(base.withValue(ItemAttribute.season, <String>[]).problem, EditProblem.seasonEmpty);
      expect(base.withValue(ItemAttribute.season, WardrobeCatalog.seasons).problem, isNull);
    });

    test('a value outside the contract is refused by the generated types', () {
      expect(() => ItemDraft.toRequest({'fit': 'baggy'}), throwsArgumentError);
      expect(
        () => ItemDraft.toRequest({
          'colors': ['white', 'neon'],
        }),
        throwsArgumentError,
      );
      expect(ItemDraft.toRequest({'fit': 'slim'}).fit, WardrobeItemPatchRequestFitEnum.slim);
    });
  });

  group('SHA-256 (NIST FIPS 180-4 vectors)', () {
    for (final (input, digest) in [
      ('', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
      ('abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
      (
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      ),
      (
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
        'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
      ),
    ]) {
      test('"${input.length > 10 ? '${input.substring(0, 10)}…' : input}"', () {
        expect(sha256Hex(Uint8List.fromList(ascii.encode(input))), digest);
      });
    }
    test('one million "a"', () {
      expect(
        sha256Hex(Uint8List.fromList(List.filled(1000000, 0x61))),
        'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
      );
    });
  });
}
