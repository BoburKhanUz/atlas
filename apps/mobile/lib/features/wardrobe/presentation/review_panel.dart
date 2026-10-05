import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../data/analysis_review.dart';
import '../data/item_edit.dart';
import 'wardrobe_labels.dart';

/// Uzbek name of an attribute.
String attributeName(ItemAttribute a) => WardrobeLabels.field(a.field);

/// The value of [a] in [draft], as Uzbek text ("—" when unknown).
String attributeValue(ItemDraft draft, ItemAttribute a) {
  final v = draft.valueOf(a);
  String one(String x) => switch (a) {
    ItemAttribute.category => WardrobeLabels.category(x),
    ItemAttribute.subcategory => WardrobeLabels.subcategory(x),
    ItemAttribute.colors => WardrobeLabels.color(x),
    ItemAttribute.pattern => WardrobeLabels.pattern(x),
    ItemAttribute.material => WardrobeLabels.material(x),
    ItemAttribute.style => WardrobeLabels.style(x),
    ItemAttribute.season => WardrobeLabels.season(x),
    ItemAttribute.sleeveLength => WardrobeLabels.sleeve(x),
    ItemAttribute.fit => WardrobeLabels.fit(x),
    ItemAttribute.formality => WardrobeLabels.formality(x),
    ItemAttribute.gender => WardrobeLabels.gender(x),
  };
  return switch (v) {
    final String s => one(s),
    final List<String> l when l.isNotEmpty => l.map(one).join(', '),
    _ => '—',
  };
}

/// High / medium / low confidence (thresholds: ConfidenceRules).
class ConfidenceChip extends StatelessWidget {
  const ConfidenceChip({super.key, required this.level});
  final ConfidenceLevel level;

  static String label(ConfidenceLevel l) => switch (l) {
    ConfidenceLevel.high => 'Yuqori ishonch',
    ConfidenceLevel.medium => 'O‘rta ishonch',
    ConfidenceLevel.low => 'Past ishonch',
  };

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (level) {
      ConfidenceLevel.high => (AtlasColors.accentStrong, AtlasColors.successSoft),
      ConfidenceLevel.medium => (AtlasColors.textSecondary, AtlasColors.skeleton),
      ConfidenceLevel.low => (AtlasColors.warning, AtlasColors.warningSoft),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.xs, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AtlasRadii.pill)),
      child: Text(label(level), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg)),
    );
  }
}

/// The detected attributes with their confidence. Low-confidence ones that
/// are not corrected (server) or acknowledged (this session) are
/// highlighted with "Correct" / "This is correct".
class AttributeReviewList extends StatelessWidget {
  const AttributeReviewList({
    super.key,
    required this.item,
    required this.acknowledged,
    required this.onAcknowledge,
    required this.onEdit,
  });

  final WardrobeItem item;
  final Set<ItemAttribute> acknowledged;
  final void Function(ItemAttribute) onAcknowledge;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final draft = ItemDraft.of(item);
    final levels = confidenceLevels(item.confidences);
    final corrected = correctedAttributes(item);
    final toReview = attributesToReview(item, acknowledged: acknowledged);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (toReview.isNotEmpty)
          Container(
            key: const Key('review.banner'),
            margin: const EdgeInsets.only(bottom: AtlasSpacing.md),
            padding: const EdgeInsets.all(AtlasSpacing.sm),
            decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
            child: Text(
              'AI ${toReview.length} ta xususiyatda ishonchsiz. Tekshirib, kerak bo‘lsa tuzating.',
              style: const TextStyle(color: AtlasColors.warning),
            ),
          ),
        for (final a in ItemAttribute.values)
          _Row(
            key: Key('review.${a.field}'),
            name: attributeName(a),
            value: attributeValue(draft, a),
            level: levels[a],
            corrected: corrected.contains(a),
            needsReview: toReview.contains(a),
            onAcknowledge: () => onAcknowledge(a),
            onEdit: onEdit,
            text: text,
          ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    super.key,
    required this.name,
    required this.value,
    required this.level,
    required this.corrected,
    required this.needsReview,
    required this.onAcknowledge,
    required this.onEdit,
    required this.text,
  });

  final String name;
  final String value;
  final ConfidenceLevel? level;
  final bool corrected;
  final bool needsReview;
  final VoidCallback onAcknowledge;
  final VoidCallback? onEdit;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AtlasSpacing.xs),
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm, vertical: AtlasSpacing.xs),
      decoration: BoxDecoration(
        color: needsReview ? AtlasColors.warningSoft : Colors.transparent,
        borderRadius: AtlasRadii.field,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xxs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(name, style: text.bodyMedium),
              if (corrected) const _Tag(label: 'Siz tuzatgansiz') else if (level != null) ConfidenceChip(level: level!),
            ],
          ),
          Text(value, style: text.bodyLarge),
          if (needsReview)
            Wrap(
              spacing: AtlasSpacing.xs,
              children: [
                TextButton(onPressed: onAcknowledge, child: const Text('To‘g‘ri')),
                if (onEdit != null) TextButton(onPressed: onEdit, child: const Text('Tuzatish')),
              ],
            ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.xs, vertical: 2),
    decoration: BoxDecoration(color: AtlasColors.accentSoft, borderRadius: BorderRadius.circular(AtlasRadii.pill)),
    child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AtlasColors.accentStrong)),
  );
}
