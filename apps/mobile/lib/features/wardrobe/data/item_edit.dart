import 'package:atlas_api/atlas_api.dart' show WardrobeItem, WardrobeItemPatchRequest, standardSerializers;
import 'package:flutter/foundation.dart';

import 'analysis_review.dart';
import 'wardrobe_catalog.dart';

/// Contract limits of WardrobeItemPatchRequest.
abstract final class EditLimits {
  static const maxColors = 5;
  static const maxSeasons = 4;
}

/// The editor's working copy of an item's attributes. Values are contract
/// wire values; clearing an attribute is not possible (the generated client
/// cannot send an explicit null) — only another valid value can be chosen.
@immutable
class ItemDraft {
  const ItemDraft({
    required this.category,
    required this.subcategory,
    required this.colors,
    required this.pattern,
    required this.material,
    required this.style,
    required this.season,
    required this.sleeveLength,
    required this.fit,
    required this.formality,
    required this.gender,
  });

  factory ItemDraft.of(WardrobeItem i) => ItemDraft(
    category: i.category,
    subcategory: i.subcategory,
    colors: i.colors.toList(),
    pattern: i.pattern,
    material: i.material,
    style: i.style,
    season: i.season.toList(),
    sleeveLength: i.sleeveLength,
    fit: i.fit,
    formality: i.formality,
    gender: i.gender,
  );

  final String category;
  final String? subcategory;
  final List<String> colors;
  final String? pattern;
  final String? material;
  final String? style;
  final List<String> season;
  final String? sleeveLength;
  final String? fit;
  final String? formality;
  final String? gender;

  Object? valueOf(ItemAttribute a) => switch (a) {
    ItemAttribute.category => category,
    ItemAttribute.subcategory => subcategory,
    ItemAttribute.colors => colors,
    ItemAttribute.pattern => pattern,
    ItemAttribute.material => material,
    ItemAttribute.style => style,
    ItemAttribute.season => season,
    ItemAttribute.sleeveLength => sleeveLength,
    ItemAttribute.fit => fit,
    ItemAttribute.formality => formality,
    ItemAttribute.gender => gender,
  };

  /// A copy with [a] set to [value]. Changing the category keeps the
  /// subcategory only when it belongs to the new category.
  ItemDraft withValue(ItemAttribute a, Object value) {
    String? s(ItemAttribute x, String? current) => a == x ? value as String : current;
    List<String> l(ItemAttribute x, List<String> current) =>
        a == x ? List.unmodifiable(value as List<String>) : current;
    final newCategory = s(ItemAttribute.category, category)!;
    var newSub = s(ItemAttribute.subcategory, subcategory);
    if (a == ItemAttribute.category && !WardrobeCatalog.subcategoriesOf(newCategory).contains(newSub)) newSub = null;
    return ItemDraft(
      category: newCategory,
      subcategory: newSub,
      colors: l(ItemAttribute.colors, colors),
      pattern: s(ItemAttribute.pattern, pattern),
      material: s(ItemAttribute.material, material),
      style: s(ItemAttribute.style, style),
      season: l(ItemAttribute.season, season),
      sleeveLength: s(ItemAttribute.sleeveLength, sleeveLength),
      fit: s(ItemAttribute.fit, fit),
      formality: s(ItemAttribute.formality, formality),
      gender: s(ItemAttribute.gender, gender),
    );
  }

  /// Why the draft cannot be saved yet (null: it can).
  EditProblem? get problem {
    if (colors.isEmpty) return EditProblem.colorsEmpty;
    if (colors.length > EditLimits.maxColors) return EditProblem.tooManyColors;
    if (season.isEmpty) return EditProblem.seasonEmpty;
    if (season.length > EditLimits.maxSeasons) return EditProblem.tooManySeasons;
    if (subcategory == null || !WardrobeCatalog.subcategoriesOf(category).contains(subcategory)) {
      return EditProblem.subcategoryMissing;
    }
    return null;
  }

  /// Attributes whose value differs from [original]. Lists compare as sets:
  /// the contract gives their order no meaning, so reordering is no change.
  Set<ItemAttribute> changesFrom(WardrobeItem original) {
    final before = ItemDraft.of(original);
    return {
      for (final a in ItemAttribute.values)
        if (!_same(before.valueOf(a), valueOf(a))) a,
    };
  }

  /// The PATCH body: only the changed attributes, as contract JSON; null
  /// when nothing changed (no request is sent then). Throws [ArgumentError]
  /// when a value is not a contract enum value.
  Map<String, Object?>? patchFrom(WardrobeItem original) {
    final changed = changesFrom(original);
    if (changed.isEmpty) return null;
    final body = {for (final a in changed) a.field: valueOf(a)};
    toRequest(body); // validates through the generated types
    return body;
  }

  /// The generated request for [body]; every value must survive the
  /// generated enum types unchanged (no unknown values are sent).
  static WardrobeItemPatchRequest toRequest(Map<String, Object?> body) {
    final WardrobeItemPatchRequest request;
    try {
      request = standardSerializers.deserializeWith(WardrobeItemPatchRequest.serializer, body)!;
    } on Object {
      throw ArgumentError('value outside the contract');
    }
    final back = standardSerializers.serializeWith(WardrobeItemPatchRequest.serializer, request)! as Map;
    if (!_deepEqual(back, body)) throw ArgumentError('value outside the contract');
    return request;
  }

  static bool _deepEqual(Map<dynamic, dynamic> a, Map<String, Object?> b) {
    if (a.length != b.length) return false;
    for (final e in b.entries) {
      final x = a[e.key];
      final y = e.value;
      if (x is List && y is List) {
        if (!listEquals(x, y)) return false;
      } else if (x != y) {
        return false;
      }
    }
    return true;
  }

  static bool _same(Object? a, Object? b) {
    if (a is List<String> && b is List<String>) return setEquals(a.toSet(), b.toSet()) && a.length == b.length;
    return a == b;
  }
}

enum EditProblem { colorsEmpty, tooManyColors, seasonEmpty, tooManySeasons, subcategoryMissing }
