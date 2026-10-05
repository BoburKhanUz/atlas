import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/session/auth_state.dart';
import '../core/session/providers.dart';
import '../core/session/session_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/register_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/outfits/presentation/outfits_screen.dart';
import '../features/profile/presentation/profile_screen.dart';
import '../features/stylist/presentation/stylist_screen.dart';
import '../features/wardrobe/presentation/wardrobe_screen.dart';
import 'shell.dart';

/// Route paths: one per tab, plus the signed-out screens. Onboarding and
/// full-screen flows are added above the shell in later phases
/// (docs/architecture/mobile-app.md).
abstract final class AtlasRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const register = '/register';
  static const home = '/home';
  static const wardrobe = '/wardrobe';
  static const outfits = '/outfits';
  static const stylist = '/stylist';
  static const profile = '/profile';
}

/// The only place that decides where an [AuthState] may be. Pure, so it is
/// tested for every state × location; applying it twice never moves again
/// (no Login → refresh → Login loops: refreshing keeps the user where they
/// are, only a session that ended leads to sign-in).
String? authRedirect(AuthState state, String location) {
  final onAuthPage = location == AtlasRoutes.login || location == AtlasRoutes.register;
  return switch (state) {
    AuthRestoring() => location == AtlasRoutes.splash ? null : AtlasRoutes.splash,
    Authenticated() ||
    Refreshing() ||
    LoggingOut() => onAuthPage || location == AtlasRoutes.splash ? AtlasRoutes.home : null,
    Unauthenticated() || SessionExpired() || Authenticating() => onAuthPage ? null : AtlasRoutes.login,
  };
}

GoRouter buildRouter({required SessionController session, String initialLocation = AtlasRoutes.home}) => GoRouter(
  initialLocation: initialLocation,
  refreshListenable: session,
  redirect: (context, state) => authRedirect(session.state, state.matchedLocation),
  routes: [
    GoRoute(path: AtlasRoutes.splash, builder: (_, _) => const SplashScreen()),
    GoRoute(path: AtlasRoutes.login, builder: (_, _) => const LoginScreen()),
    GoRoute(path: AtlasRoutes.register, builder: (_, _) => const RegisterScreen()),
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
  final router = buildRouter(session: ref.watch(sessionControllerProvider));
  ref.onDispose(router.dispose);
  return router;
});
