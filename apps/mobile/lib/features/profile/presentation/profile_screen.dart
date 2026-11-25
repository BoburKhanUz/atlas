import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/auth_state.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../legal/data/legal_repository.dart' show LegalDocumentKind;
import '../../onboarding/data/options.dart';
import '../data/color_profile_repository.dart';
import '../providers.dart';
import 'color_profile_controller.dart';
import 'profile_controller.dart';
import 'profile_labels.dart';

/// The Profile tab: who you are (name, email), your style and colour
/// preferences, your colour profile, and account settings.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(profileProvider);
    final auth = ref.watch(authStateProvider);
    final p = s.profile;

    return AtlasPage(
      title: 'Profil',
      onRefresh: () async {
        await Future.wait([
          ref.read(profileProvider.notifier).refresh(),
          ref.read(colorProfileProvider.notifier).refresh(),
        ]);
      },
      slivers: [
        if (s.status == ProfileStatus.loading)
          const SliverFillRemaining(child: LoadingView(items: 2))
        else if (p == null)
          SliverFillRemaining(
            child: s.failure is NoNetworkFailure
                ? OfflineStateView(onRetry: ref.read(profileProvider.notifier).refresh)
                : ErrorStateView(
                    message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.',
                    onRetry: ref.read(profileProvider.notifier).refresh,
                  ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
            sliver: SliverList.list(
              children: [
                if (s.failure case final failure?)
                  RefreshFailedBanner(
                    message: failure.userMessage,
                    onRetry: ref.read(profileProvider.notifier).refresh,
                  ),
                _ProfileHeader(name: p.name, email: p.email, onTap: () => context.push(AtlasRoutes.profileEdit)),
                const SizedBox(height: AtlasSpacing.md),
                _Completion(
                  steps: [
                    p.name != null && p.name!.trim().isNotEmpty,
                    p.preferredStyles.isNotEmpty,
                    p.favoriteColors.isNotEmpty,
                    ref.watch(colorProfileProvider.select((c) => c.current is Analysed)),
                  ],
                ),
                const SizedBox(height: AtlasSpacing.md),
                _Preferences(
                  title: 'Uslub',
                  liked: [
                    for (final o in StyleOption.values)
                      if (p.preferredStyles.contains(o)) o.label,
                  ],
                  disliked: [
                    for (final o in StyleOption.values)
                      if (p.dislikedStyles.contains(o)) o.label,
                  ],
                  onEdit: () => context.push(AtlasRoutes.profileEdit),
                ),
                const SizedBox(height: AtlasSpacing.sm),
                _Preferences(
                  title: 'Ranglar',
                  liked: [
                    for (final o in ColorOption.values)
                      if (p.favoriteColors.contains(o)) o.label,
                  ],
                  disliked: [
                    for (final o in ColorOption.values)
                      if (p.dislikedColors.contains(o)) o.label,
                  ],
                  swatches: {for (final o in ColorOption.values) o.label: o.swatch},
                  onEdit: () => context.push(AtlasRoutes.profileEdit),
                ),
                const SizedBox(height: AtlasSpacing.xs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const Key('profile.edit'),
                    onPressed: () => context.push(AtlasRoutes.profileEdit),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Afzalliklarni tahrirlash'),
                  ),
                ),
                const SizedBox(height: AtlasSpacing.md),
                const _ColorProfileCard(),
                const SizedBox(height: AtlasSpacing.lg),
                const SectionHeader('Hisob'),
                AtlasButton(
                  key: const Key('profile.logout'),
                  label: 'Chiqish',
                  icon: Icons.logout_rounded,
                  variant: AtlasButtonVariant.secondary,
                  loading: auth is LoggingOut,
                  onPressed: () => ref.read(sessionControllerProvider).logout(),
                ),
                const SizedBox(height: AtlasSpacing.xs),
                TextButton.icon(
                  key: const Key('profile.delete'),
                  onPressed: () => context.push(AtlasRoutes.profileDelete),
                  icon: const Icon(Icons.delete_forever_outlined, color: AtlasColors.error),
                  label: const Text('Hisobni o‘chirish', style: TextStyle(color: AtlasColors.error)),
                ),
                const SizedBox(height: AtlasSpacing.lg),
                const SectionHeader('Huquqiy hujjatlar'),
                AtlasCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      for (final kind in LegalDocumentKind.values)
                        ListTile(
                          key: Key('profile.${kind.name}'),
                          leading: const Icon(Icons.description_outlined),
                          title: Text(kind.label),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => context.push(AtlasRoutes.legal(kind)),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AtlasSpacing.xl),
              ],
            ),
          ),
      ],
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.name, required this.email, required this.onTap});
  final String? name;
  final String email;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final trimmed = name?.trim();
    final hasName = trimmed != null && trimmed.isNotEmpty;
    return Material(
      key: const Key('profile.card'),
      color: Colors.transparent,
      child: Ink(
        decoration: const BoxDecoration(gradient: AtlasColors.heroGradient, borderRadius: AtlasRadii.card),
        child: InkWell(
          borderRadius: AtlasRadii.card,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AtlasSpacing.md),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: AtlasColors.onAccent.withValues(alpha: 0.16),
                  foregroundColor: AtlasColors.onAccent,
                  child: hasName
                      ? Text(
                          trimmed.characters.first.toUpperCase(),
                          style: text.headlineMedium?.copyWith(color: AtlasColors.onAccent),
                        )
                      : const Icon(Icons.person_outline_rounded, size: 30),
                ),
                const SizedBox(width: AtlasSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        hasName ? trimmed : 'Ismingizni kiriting',
                        key: const Key('profile.name'),
                        style: text.titleLarge?.copyWith(color: AtlasColors.onAccent),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        email,
                        key: const Key('profile.email'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodyMedium?.copyWith(color: AtlasColors.onInkMuted),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: AtlasColors.onAccent),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// How much of the profile is filled in, and why it matters.
class _Completion extends StatelessWidget {
  const _Completion({required this.steps});
  final List<bool> steps;

  @override
  Widget build(BuildContext context) {
    final done = steps.where((s) => s).length;
    if (done == steps.length) return const SizedBox.shrink();
    final text = Theme.of(context).textTheme;
    final percent = (done * 100 / steps.length).round();
    return AtlasCard(
      key: const Key('profile.completion'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Profil $percent% to‘ldirilgan', style: text.titleMedium)),
              Text('$done / ${steps.length}', style: text.labelLarge?.copyWith(color: AtlasColors.accent)),
            ],
          ),
          const SizedBox(height: AtlasSpacing.xs),
          ClipRRect(
            borderRadius: BorderRadius.circular(AtlasRadii.pill),
            child: LinearProgressIndicator(value: done / steps.length, minHeight: 8),
          ),
          const SizedBox(height: AtlasSpacing.xs),
          Text('Ism, uslub, ranglar va rang profilini to‘ldiring — tavsiyalar aniqroq bo‘ladi.', style: text.bodySmall),
        ],
      ),
    );
  }
}

class _Preferences extends StatelessWidget {
  const _Preferences({
    required this.title,
    required this.liked,
    required this.disliked,
    required this.onEdit,
    this.swatches = const {},
  });
  final String title;
  final List<String> liked;
  final List<String> disliked;
  final Map<String, Color> swatches;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    Widget pill(String label, {required bool liked}) {
      final swatch = swatches[label];
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm, vertical: AtlasSpacing.xxs + 2),
        decoration: BoxDecoration(
          color: liked ? AtlasColors.accentSoft : AtlasColors.surface,
          borderRadius: BorderRadius.circular(AtlasRadii.pill),
          border: Border.all(color: liked ? AtlasColors.accentSoft : AtlasColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (swatch != null) ...[
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: swatch,
                  shape: BoxShape.circle,
                  border: Border.all(color: AtlasColors.hairline),
                ),
              ),
              const SizedBox(width: AtlasSpacing.xxs + 2),
            ] else if (!liked) ...[
              const Icon(Icons.block_rounded, size: 14, color: AtlasColors.textSecondary),
              const SizedBox(width: AtlasSpacing.xxs),
            ],
            Flexible(
              child: Text(
                label,
                style: text.labelLarge?.copyWith(
                  color: liked ? AtlasColors.accentStrong : AtlasColors.textSecondary,
                  decoration: liked ? null : TextDecoration.lineThrough,
                ),
              ),
            ),
          ],
        ),
      );
    }

    Widget group(String label, List<String> values, {required bool liked}) => Padding(
      padding: const EdgeInsets.only(top: AtlasSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall),
          const SizedBox(height: AtlasSpacing.xxs),
          if (values.isEmpty)
            InkWell(
              onTap: onEdit,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AtlasSpacing.xxs),
                child: Text('Hali tanlanmagan — tanlash', style: text.labelLarge?.copyWith(color: AtlasColors.accent)),
              ),
            )
          else
            Wrap(
              spacing: AtlasSpacing.xs,
              runSpacing: AtlasSpacing.xs,
              children: [for (final v in values) pill(v, liked: liked)],
            ),
        ],
      ),
    );

    return AtlasCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: text.titleMedium),
          group('Yoqadi', liked, liked: true),
          // Dislikes are optional: shown only once there are some.
          if (disliked.isNotEmpty) group('Yoqmaydi', disliked, liked: false),
        ],
      ),
    );
  }
}

class _ColorProfileCard extends ConsumerWidget {
  const _ColorProfileCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(colorProfileProvider);
    final text = Theme.of(context).textTheme;
    final subtitle = switch (s.current) {
      Analysed(:final profile) =>
        '${ProfileLabels.season(profile.season)} · ${ProfileLabels.undertone(profile.undertone)} ton',
      NotAnalysed() => 'Hali aniqlanmagan',
      null when s.status == ColorProfileStatus.failed => 'Yuklab bo‘lmadi',
      null => 'Yuklanmoqda…',
    };
    return AtlasCard(
      key: const Key('profile.color'),
      onTap: () => context.push(AtlasRoutes.profileColor),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: const BoxDecoration(color: AtlasColors.sand, shape: BoxShape.circle),
            child: const Icon(Icons.palette_outlined, color: AtlasColors.ink),
          ),
          const SizedBox(width: AtlasSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Rang profili', style: text.titleMedium),
                Text(subtitle, style: text.bodySmall),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded),
        ],
      ),
    );
  }
}
