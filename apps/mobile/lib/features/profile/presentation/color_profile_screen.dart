import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../wardrobe/data/analysis_review.dart' show ConfidenceLevel, ConfidenceRules;
import '../data/color_profile_repository.dart';
import '../providers.dart';
import 'color_profile_controller.dart';
import 'profile_labels.dart';

/// The server's current colour profile.
class ColorProfileScreen extends ConsumerWidget {
  const ColorProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(colorProfileProvider);
    final c = ref.read(colorProfileProvider.notifier);
    final Widget body = switch (s.current) {
      null when s.status == ColorProfileStatus.failed =>
        s.failure is NoNetworkFailure
            ? OfflineStateView(onRetry: c.refresh)
            : ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.refresh),
      null => const LoadingView(items: 2),
      NotAnalysed(:final message) => EmptyStateView(
        key: const Key('color.notAnalysed'),
        icon: Icons.palette_outlined,
        title: 'Rang profili aniqlanmagan',
        message: message,
        actionLabel: 'Selfi orqali aniqlash',
        onAction: () => context.push(AtlasRoutes.profileColorAnalyze),
      ),
      final Analysed a => RefreshIndicator(
        onRefresh: c.refresh,
        child: ListView(
          padding: const EdgeInsets.all(AtlasSpacing.screen),
          children: [
            ColorProfileView(analysed: a),
            const SizedBox(height: AtlasSpacing.lg),
            AtlasButton(
              key: const Key('color.reanalyze'),
              label: 'Qayta aniqlash',
              icon: Icons.camera_front_outlined,
              variant: AtlasButtonVariant.secondary,
              onPressed: () => context.push(AtlasRoutes.profileColorAnalyze),
            ),
          ],
        ),
      ),
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Rang profili')),
      body: SafeArea(child: body),
    );
  }
}

/// One colour profile (server's current one, or an analysis result).
class ColorProfileView extends StatelessWidget {
  const ColorProfileView({super.key, required this.analysed});
  final Analysed analysed;

  @override
  Widget build(BuildContext context) {
    final p = analysed.profile;
    final text = Theme.of(context).textTheme;
    final confidence = p.confidence;
    final low = confidence != null && ConfidenceRules.levelOf(confidence) == ConfidenceLevel.low;
    final d = p.analyzedAt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return Column(
      key: const Key('color.analysed'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (low)
          Container(
            key: const Key('color.lowConfidence'),
            margin: const EdgeInsets.only(bottom: AtlasSpacing.md),
            padding: const EdgeInsets.all(AtlasSpacing.sm),
            decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
            child: const Text(
              'Natija ishonchsiz: rasmda yuz yaxshi ko‘rinmagan bo‘lishi mumkin. '
              'Kunduzgi yorug‘likda, yuz to‘liq ko‘rinadigan selfi bilan qayta urinib ko‘ring.',
              style: TextStyle(color: AtlasColors.warning),
            ),
          ),
        AtlasCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Mavsum: ${ProfileLabels.season(p.season)}', key: const Key('color.season'), style: text.titleLarge),
              const SizedBox(height: AtlasSpacing.xs),
              Text(
                'Ton: ${ProfileLabels.undertone(p.undertone)} · Kontrast: ${ProfileLabels.contrast(p.contrastLevel)}',
              ),
              Text(
                'Teri: ${ProfileLabels.skinTone(p.skinTone)} · Soch: ${ProfileLabels.color(p.hairColor)} · '
                'Ko‘z: ${ProfileLabels.color(p.eyeColor)}',
              ),
              Text(
                'Aniqlangan: ${two(d.day)}.${two(d.month)}.${d.year}'
                '${confidence == null ? '' : ' · Ishonch: ${(confidence * 100).round()}%'}',
                key: const Key('color.date'),
                style: text.bodySmall,
              ),
            ],
          ),
        ),
        const SizedBox(height: AtlasSpacing.md),
        _Palette(title: 'Sizga mos ranglar', colors: p.recommendedColors, keyName: 'color.recommended'),
        _Palette(title: 'Neytral ranglar', colors: p.neutralColors, keyName: 'color.neutral'),
        _Palette(title: 'Ehtiyot bo‘ling', colors: p.cautionColors, keyName: 'color.caution'),
        const SizedBox(height: AtlasSpacing.sm),
        Text(analysed.disclaimer, key: const Key('color.disclaimer'), style: text.bodySmall),
      ],
    );
  }
}

class _Palette extends StatelessWidget {
  const _Palette({required this.title, required this.colors, required this.keyName});
  final String title;
  final List<String> colors;
  final String keyName;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      key: Key(keyName),
      padding: const EdgeInsets.only(bottom: AtlasSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: text.titleSmall),
          const SizedBox(height: AtlasSpacing.xs),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            children: [
              for (final c in colors)
                Chip(
                  avatar: Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      color: ProfileLabels.option(c)?.swatch ?? AtlasColors.skeleton,
                      shape: BoxShape.circle,
                      border: Border.all(color: AtlasColors.hairline),
                    ),
                  ),
                  label: Text(ProfileLabels.color(c)),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
