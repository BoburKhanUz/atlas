import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../onboarding/data/options.dart' show ColorOption;
import '../data/analysis_review.dart';
import '../data/item_edit.dart';
import '../data/wardrobe_catalog.dart';
import '../providers.dart';
import 'edit_item_controller.dart';
import 'review_panel.dart';
import 'wardrobe_labels.dart';

/// Correct the detected attributes. Only valid contract values can be
/// chosen (no "clear"); Save sends one PATCH with just the changes.
class EditItemScreen extends ConsumerWidget {
  const EditItemScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = editItemControllerProvider(id);
    final s = ref.watch(provider);
    final c = ref.read(provider.notifier);
    ref.listen(provider.select((x) => x.status), (_, status) {
      if (status == EditStatus.saved && context.canPop()) context.pop();
      if (status == EditStatus.notFound) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Kiyim topilmadi — u o‘chirilgan.')));
        if (context.canPop()) context.pop();
      }
    });

    final body = switch (s.status) {
      EditStatus.loading => const LoadingView(),
      EditStatus.loadFailed => ErrorStateView(
        message: s.failure?.userMessage ?? 'Nimadir xato ketdi.',
        onRetry: c.retryLoad,
      ),
      EditStatus.notFound => const SizedBox.shrink(),
      _ => _Editor(state: s, controller: c),
    };
    return PopScope(
      canPop: s.status != EditStatus.saving,
      child: Scaffold(
        appBar: AppBar(title: const Text('Xususiyatlarni tuzatish')),
        body: SafeArea(child: body),
      ),
    );
  }
}

class _Editor extends StatelessWidget {
  const _Editor({required this.state, required this.controller});
  final EditState state;
  final EditItemController controller;

  @override
  Widget build(BuildContext context) {
    final draft = state.draft!;
    final original = state.original!;
    final toReview = attributesToReview(original);
    final saving = state.status == EditStatus.saving;
    final problem = draft.problem;
    final text = Theme.of(context).textTheme;

    Widget section(ItemAttribute a, Widget child, {String? hint}) => Padding(
      key: Key('edit.section.${a.field}'),
      padding: const EdgeInsets.only(bottom: AtlasSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AtlasSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(attributeName(a), style: text.titleSmall),
              if (toReview.contains(a)) const ConfidenceChip(level: ConfidenceLevel.low),
              if (state.changes.contains(a)) Text('o‘zgartirildi', style: text.labelSmall),
            ],
          ),
          if (hint != null) Text(hint, style: text.bodySmall),
          const SizedBox(height: AtlasSpacing.xs),
          child,
          if (state.fieldErrors[a] case final error?)
            Text(error, style: text.bodySmall?.copyWith(color: AtlasColors.error)),
        ],
      ),
    );

    Widget single(ItemAttribute a, List<String> options, String Function(String) label) => _Choices(
      keyPrefix: 'edit.${a.field}',
      options: options,
      label: label,
      selected: {?draft.valueOf(a) as String?},
      enabled: !saving,
      onTap: (v) => controller.set(a, v),
    );

    Widget multi(ItemAttribute a, List<String> options, String Function(String) label, int max) {
      final selected = (draft.valueOf(a)! as List<String>).toSet();
      return _Choices(
        keyPrefix: 'edit.${a.field}',
        options: options,
        label: label,
        selected: selected,
        enabled: !saving,
        disabled: (v) => !selected.contains(v) && selected.length >= max,
        swatch: a == ItemAttribute.colors ? (v) => ColorOption.values.firstWhere((o) => o.wire == v).swatch : null,
        onTap: (v) {
          final current = draft.valueOf(a)! as List<String>;
          controller.set(a, current.contains(v) ? [...current.where((x) => x != v)] : [...current, v]);
        },
      );
    }

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(AtlasSpacing.screen),
            children: [
              section(
                ItemAttribute.category,
                single(ItemAttribute.category, WardrobeCatalog.categories, WardrobeLabels.category),
              ),
              section(
                ItemAttribute.subcategory,
                single(
                  ItemAttribute.subcategory,
                  WardrobeCatalog.subcategoriesOf(draft.category),
                  WardrobeLabels.subcategory,
                ),
                hint: problem == EditProblem.subcategoryMissing ? 'Toifaga mos turni tanlang' : null,
              ),
              section(
                ItemAttribute.colors,
                multi(ItemAttribute.colors, WardrobeCatalog.colors, WardrobeLabels.color, EditLimits.maxColors),
                hint: 'Ko‘pi bilan ${EditLimits.maxColors} ta, kamida bitta',
              ),
              section(
                ItemAttribute.pattern,
                single(ItemAttribute.pattern, WardrobeCatalog.patterns, WardrobeLabels.pattern),
              ),
              section(
                ItemAttribute.material,
                single(ItemAttribute.material, WardrobeCatalog.materials, WardrobeLabels.material),
              ),
              section(ItemAttribute.style, single(ItemAttribute.style, WardrobeCatalog.styles, WardrobeLabels.style)),
              section(
                ItemAttribute.season,
                multi(ItemAttribute.season, WardrobeCatalog.seasons, WardrobeLabels.season, EditLimits.maxSeasons),
                hint: 'Kamida bitta mavsum',
              ),
              section(
                ItemAttribute.sleeveLength,
                single(ItemAttribute.sleeveLength, WardrobeCatalog.sleeveLengths, WardrobeLabels.sleeve),
              ),
              section(ItemAttribute.fit, single(ItemAttribute.fit, WardrobeCatalog.fits, WardrobeLabels.fit)),
              section(
                ItemAttribute.formality,
                single(ItemAttribute.formality, WardrobeCatalog.formalities, WardrobeLabels.formality),
              ),
              section(
                ItemAttribute.gender,
                single(ItemAttribute.gender, WardrobeCatalog.genders, WardrobeLabels.gender),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AtlasSpacing.screen,
            AtlasSpacing.xs,
            AtlasSpacing.screen,
            AtlasSpacing.md,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (state.status == EditStatus.failed)
                Padding(
                  padding: const EdgeInsets.only(bottom: AtlasSpacing.xs),
                  child: Text(
                    state.failure?.userMessage ?? 'Saqlab bo‘lmadi.',
                    key: const Key('edit.failure'),
                    style: const TextStyle(color: AtlasColors.error),
                  ),
                ),
              AtlasButton(
                key: const Key('edit.save'),
                label: state.status == EditStatus.failed ? 'Qayta urinish' : 'Saqlash',
                loading: saving,
                onPressed: problem == null ? controller.save : null,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Choices extends StatelessWidget {
  const _Choices({
    required this.keyPrefix,
    required this.options,
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
    this.disabled,
    this.swatch,
  });

  final String keyPrefix;
  final List<String> options;
  final String Function(String) label;
  final Set<String> selected;
  final bool enabled;
  final void Function(String) onTap;
  final bool Function(String)? disabled;
  final Color Function(String)? swatch;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AtlasSpacing.xs,
    runSpacing: AtlasSpacing.xs,
    children: [
      for (final o in options)
        FilterChip(
          key: Key('$keyPrefix.$o'),
          label: Text(label(o)),
          selected: selected.contains(o),
          showCheckmark: swatch == null,
          avatar: swatch == null
              ? null
              : Container(
                  width: 16,
                  height: 16,
                  decoration: BoxDecoration(
                    color: swatch!(o),
                    shape: BoxShape.circle,
                    border: Border.all(color: AtlasColors.hairline),
                  ),
                ),
          onSelected: !enabled || (disabled?.call(o) ?? false) ? null : (_) => onTap(o),
          materialTapTargetSize: MaterialTapTargetSize.padded,
        ),
    ],
  );
}
