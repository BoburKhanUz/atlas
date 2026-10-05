import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/home/presentation/home_screen.dart';
import '../features/outfits/presentation/outfits_screen.dart';
import '../features/profile/presentation/profile_screen.dart';
import '../features/stylist/presentation/stylist_screen.dart';
import '../features/wardrobe/presentation/wardrobe_screen.dart';
import 'shell.dart';

/// Route paths, one per tab. Auth, onboarding and full-screen flows are
/// added above the shell in later phases (docs/architecture/mobile-app.md).
abstract final class AtlasRoutes {
  static const home = '/home';
  static const wardrobe = '/wardrobe';
  static const outfits = '/outfits';
  static const stylist = '/stylist';
  static const profile = '/profile';
}

GoRouter buildRouter({String initialLocation = AtlasRoutes.home}) => GoRouter(
  initialLocation: initialLocation,
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => AtlasShell(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          routes: [GoRoute(path: AtlasRoutes.home, builder: (_, _) => const HomeScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: AtlasRoutes.wardrobe, builder: (_, _) => const WardrobeScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: AtlasRoutes.outfits, builder: (_, _) => const OutfitsScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: AtlasRoutes.stylist, builder: (_, _) => const StylistScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: AtlasRoutes.profile, builder: (_, _) => const ProfileScreen())],
        ),
      ],
    ),
  ],
);

final routerProvider = Provider<GoRouter>((ref) {
  final router = buildRouter();
  ref.onDispose(router.dispose);
  return router;
});
