import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:built_collection/built_collection.dart';

/// Confidence bands — the same thresholds as the web client (the contract
/// defines none). The only place they are defined.
enum ConfidenceLevel { high, medium, low }

abstract final class ConfidenceRules {
  static const high = 0.70;
  static const medium = 0.40;

  static ConfidenceLevel levelOf(num confidence) => confidence >= high
      ? ConfidenceLevel.high
      : confidence >= medium
      ? ConfidenceLevel.medium
      : ConfidenceLevel.low;
}

/// The detected attributes of a wardrobe item: the PATCHable fields of the
/// contract and the server's confidence key for each (`color` → `colors`).
enum ItemAttribute {
  category('category', 'category'),
  subcategory('subcategory', 'subcategory'),
  colors('colors', 'color'),
  pattern('pattern', 'pattern'),
  material('material', 'material'),
  style('style', 'style'),
  season('season', 'season'),
  sleeveLength('sleeveLength', 'sleeveLength'),
  fit('fit', 'fit'),
  formality('formality', 'formality'),
  gender('gender', 'gender');

  const ItemAttribute(this.field, this.confidenceKey);

  /// Field name in WardrobeItem / WardrobeItemPatchRequest / correctionLog.
  final String field;

  /// Key in `confidences`.
  final String confidenceKey;

  static final _byConfidenceKey = {for (final a in values) a.confidenceKey: a};
  static final _byField = {for (final a in values) a.field: a};

  /// Unknown keys (a newer backend) → null (ignored).
  static ItemAttribute? fromConfidenceKey(String key) => _byConfidenceKey[key];
  static ItemAttribute? fromField(String field) => _byField[field];
}

/// Confidence level per attribute; unknown keys are ignored.
Map<ItemAttribute, ConfidenceLevel> confidenceLevels(BuiltMap<String, num> confidences) => {
  for (final e in confidences.entries) ?ItemAttribute.fromConfidenceKey(e.key): ConfidenceRules.levelOf(e.value),
};

/// Attributes the user corrected on the server (`correctionLog`).
Set<ItemAttribute> correctedAttributes(WardrobeItem item) => {
  for (final c in item.correctionLog) ?ItemAttribute.fromField(c.field),
};

/// Low-confidence attributes still to review: not corrected on the server
/// and not acknowledged ("this is correct") in the current review session.
/// Server data is never changed by an acknowledgement.
Set<ItemAttribute> attributesToReview(WardrobeItem item, {Set<ItemAttribute> acknowledged = const {}}) {
  final corrected = correctedAttributes(item);
  return {
    for (final e in confidenceLevels(item.confidences).entries)
      if (e.value == ConfidenceLevel.low && !corrected.contains(e.key) && !acknowledged.contains(e.key)) e.key,
  };
}

bool needsReview(WardrobeItem item) => attributesToReview(item).isNotEmpty;
