import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/session/auth_state.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/coming_soon.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(authStateProvider);
    final user = state.user;
    return AtlasPage(
      title: 'Profil',
      body: Column(
        children: [
          if (user != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.account_circle_outlined),
                title: Text(user.name ?? user.email),
                subtitle: user.name == null ? null : Text(user.email),
              ),
            ),
          const Expanded(
            child: ComingSoonView(
              icon: Icons.person_outline_rounded,
              title: 'Profilingiz',
              message: 'Uslub afzalliklari, rang profili va hisob sozlamalari shu yerda bo‘ladi.',
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AtlasSpacing.screen),
            child: AtlasButton(
              key: const Key('profile.logout'),
              label: 'Chiqish',
              icon: Icons.logout_rounded,
              variant: AtlasButtonVariant.secondary,
              loading: state is LoggingOut,
              onPressed: () => ref.read(sessionControllerProvider).logout(),
            ),
          ),
        ],
      ),
    );
  }
}
