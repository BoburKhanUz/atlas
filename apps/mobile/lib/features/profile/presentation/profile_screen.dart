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
    final text = Theme.of(context).textTheme;
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
                AtlasCard(
                  key: const Key('profile.card'),
                  onTap: () => context.push(AtlasRoutes.profileEdit),
                  child: Row(
                    children: [
                      const CircleAvatar(
                        backgroundColor: AtlasColors.accentSoft,
                        child: Icon(Icons.person_outline_rounded, color: AtlasColors.accent),
                      ),
                      const SizedBox(width: AtlasSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              p.name ?? 'Ismingizni kiriting',
                              key: const Key('profile.name'),
                              style: text.titleMedium,
                            ),
                            Text(p.email, key: const Key('profile.email'), style: text.bodySmall),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded),
                    ],
                  ),
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
                ),
                const SizedBox(height: AtlasSpacing.xs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const Key('profile.edit'),
                    onPressed: () => context.push(AtlasRoutes.profileEdit),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Tahrirlash'),
                  ),
                ),
                const SizedBox(height: AtlasSpacing.md),
                const _ColorProfileCard(),
                const SizedBox(height: AtlasSpacing.lg),
                Text('Hisob', style: text.titleSmall),
                const SizedBox(height: AtlasSpacing.xs),
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
                const SizedBox(height: AtlasSpacing.xl),
              ],
            ),
          ),
      ],
    );
  }
}

class _Preferences extends StatelessWidget {
  const _Preferences({required this.title, required this.liked, required this.disliked});
  final String title;
  final List<String> liked;
  final List<String> disliked;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    Widget row(String label, List<String> values) => Padding(
      padding: const EdgeInsets.only(top: AtlasSpacing.xxs),
      child: Text('$label: ${values.isEmpty ? 'tanlanmagan' : values.join(', ')}', style: text.bodyMedium),
    );
    return AtlasCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: text.titleSmall),
          row('Yoqadi', liked),
          row('Yoqmaydi', disliked),
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
          const Icon(Icons.palette_outlined, color: AtlasColors.accent),
          const SizedBox(width: AtlasSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Rang profili', style: text.titleSmall),
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
