import 'package:atlas_api/atlas_api.dart' show OutfitSummary;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../weather/presentation/weather_card.dart';
import '../data/outfits_repository.dart';
import '../providers.dart';
import 'candidate_card.dart';
import 'generate_controller.dart';
import 'outfit_images.dart';
import 'outfit_labels.dart';
import 'outfit_list_controller.dart';

class OutfitsScreen extends ConsumerWidget {
  const OutfitsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(outfitsTabProvider);
    return AtlasPage(
      title: 'Obrazlar',
      onRefresh: switch (tab) {
        OutfitsTab.suggest => null,
        OutfitsTab.saved => () => ref.read(outfitListProvider(true).notifier).refresh(),
        OutfitsTab.recent => () => ref.read(outfitListProvider(false).notifier).refresh(),
      },
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
          sliver: SliverToBoxAdapter(
            child: SegmentedButton<OutfitsTab>(
              key: const Key('outfits.tabs'),
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                  value: OutfitsTab.suggest,
                  label: Text('Tavsiya'),
                  icon: Icon(Icons.auto_awesome_outlined),
                ),
                ButtonSegment(value: OutfitsTab.saved, label: Text('Saqlangan'), icon: Icon(Icons.bookmark_outline)),
                ButtonSegment(value: OutfitsTab.recent, label: Text('So‘nggi'), icon: Icon(Icons.history_rounded)),
              ],
              selected: {tab},
              onSelectionChanged: (s) => ref.read(outfitsTabProvider.notifier).show(s.single),
            ),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: AtlasSpacing.md)),
        switch (tab) {
          OutfitsTab.suggest => const _Suggestions(),
          OutfitsTab.saved => const _OutfitList(savedOnly: true),
          OutfitsTab.recent => const _OutfitList(savedOnly: false),
        },
        const SliverToBoxAdapter(child: SizedBox(height: AtlasSpacing.xl)),
      ],
    );
  }
}

class _Suggestions extends ConsumerWidget {
  const _Suggestions();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(generateControllerProvider);
    final c = ref.read(generateControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final generating = s.phase == GeneratePhase.generating;
    final result = s.result;
    final used = result?.weatherUsed;

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
      sliver: SliverList.list(
        children: [
          const WeatherCard(),
          const SizedBox(height: AtlasSpacing.md),
          Text('Qayerga?', style: text.titleSmall),
          const SizedBox(height: AtlasSpacing.xs),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            children: [
              ChoiceChip(
                key: const Key('outfits.occasion.any'),
                label: const Text('Farqi yo‘q'),
                selected: s.occasion == null,
                onSelected: generating ? null : (_) => c.chooseOccasion(null),
              ),
              for (final o in outfitOccasions)
                ChoiceChip(
                  key: Key('outfits.occasion.$o'),
                  label: Text(OutfitLabels.occasion(o)),
                  selected: s.occasion == o,
                  onSelected: generating ? null : (_) => c.chooseOccasion(o),
                ),
            ],
          ),
          const SizedBox(height: AtlasSpacing.md),
          AtlasButton(
            key: const Key('outfits.generate'),
            label: result == null ? 'Obraz tanlash' : 'Boshqa variant',
            icon: result == null ? Icons.auto_awesome_rounded : Icons.refresh_rounded,
            loading: generating,
            onPressed: c.generate,
          ),
          if (s.phase == GeneratePhase.failed) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Text(
              s.failure is NoNetworkFailure
                  ? 'Internet aloqasi yo‘q. Ulanib, qayta urinib ko‘ring.'
                  : s.failure?.userMessage ?? 'Obraz tanlab bo‘lmadi. Qayta urinib ko‘ring.',
              key: const Key('outfits.failure'),
              style: text.bodyMedium?.copyWith(color: AtlasColors.error),
            ),
          ],
          if (generating && result == null)
            const SizedBox(height: 420, child: LoadingView(items: 2, semanticLabel: 'Obrazlar tanlanmoqda')),
          if (result != null) ...[
            const SizedBox(height: AtlasSpacing.md),
            if (used != null)
              Text(
                'Ob-havo: ${OutfitLabels.temperature(used.temperature)} · ${OutfitLabels.condition(used.condition)}',
                key: const Key('outfits.weatherUsed'),
                style: text.bodySmall,
              )
            else
              Text('Ob-havo hisobga olinmadi', key: const Key('outfits.noWeather'), style: text.bodySmall),
            const SizedBox(height: AtlasSpacing.sm),
            if (result.outfits.isEmpty)
              AtlasCard(
                key: const Key('outfits.empty'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(result.message ?? 'Hozircha mos obraz topilmadi.', style: text.bodyMedium),
                    const SizedBox(height: AtlasSpacing.sm),
                    AtlasButton(
                      key: const Key('outfits.addItem'),
                      label: 'Kiyim qo‘shish',
                      icon: Icons.add_a_photo_outlined,
                      variant: AtlasButtonVariant.secondary,
                      onPressed: () => context.push(AtlasRoutes.wardrobeAdd),
                    ),
                  ],
                ),
              )
            else
              for (final o in result.outfits) ...[
                CandidateCard(key: ValueKey(o.tempId), candidate: o),
                const SizedBox(height: AtlasSpacing.md),
              ],
          ],
        ],
      ),
    );
  }
}

class _OutfitList extends ConsumerWidget {
  const _OutfitList({required this.savedOnly});
  final bool savedOnly;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = outfitListProvider(savedOnly);
    final s = ref.watch(provider);
    final c = ref.read(provider.notifier);
    if (s.status == OutfitListStatus.loading) return const SliverFillRemaining(child: LoadingView());
    if (s.status == OutfitListStatus.failed) {
      return SliverFillRemaining(
        child: s.failure is NoNetworkFailure
            ? OfflineStateView(onRetry: c.refresh)
            : ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.refresh),
      );
    }
    if (s.outfits.isEmpty) {
      return SliverFillRemaining(
        child: EmptyStateView(
          key: Key(savedOnly ? 'outfits.saved.empty' : 'outfits.recent.empty'),
          icon: savedOnly ? Icons.bookmark_outline : Icons.history_rounded,
          title: savedOnly ? 'Saqlangan obrazlar yo‘q' : 'Hali obraz yo‘q',
          message: 'Tavsiya bo‘limida obraz tanlang va yoqqanini saqlang.',
        ),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
      sliver: SliverList.separated(
        itemCount: s.outfits.length,
        separatorBuilder: (_, _) => const SizedBox(height: AtlasSpacing.sm),
        itemBuilder: (context, i) => _OutfitRow(outfit: s.outfits[i], onExpired: c.refresh),
      ),
    );
  }
}

class _OutfitRow extends StatelessWidget {
  const _OutfitRow({required this.outfit, required this.onExpired});
  final OutfitSummary outfit;
  final VoidCallback onExpired;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final weather = OutfitLabels.snapshot(outfit.weatherSnapshot);
    final title =
        outfit.name ?? (outfit.occasion == null ? 'Obraz' : '${OutfitLabels.occasion(outfit.occasion!)} uchun obraz');
    return AtlasCard(
      key: Key('outfit.list.${outfit.id}'),
      onTap: () => context.push(AtlasRoutes.outfitDetail(outfit.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title, style: text.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
              ),
              if (outfit.isSaved)
                const Icon(Icons.bookmark_rounded, color: AtlasColors.accent, semanticLabel: 'Saqlangan'),
            ],
          ),
          Text([?weather, if (outfit.score != null) 'Moslik ${outfit.score}%'].join(' · '), style: text.bodySmall),
          const SizedBox(height: AtlasSpacing.sm),
          SizedBox(
            height: 64,
            child: Row(
              children: [
                for (final item in outfit.items.take(4)) ...[
                  ClipRRect(
                    borderRadius: AtlasRadii.field,
                    child: SizedBox.square(
                      dimension: 64,
                      child: StoredItemImage(image: item.image, onExpired: onExpired),
                    ),
                  ),
                  const SizedBox(width: AtlasSpacing.xs),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
