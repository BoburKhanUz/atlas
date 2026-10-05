import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/session/auth_state.dart';
import '../core/session/providers.dart';
import '../core/session/session_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/register_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/onboarding/onboarding_gate.dart';
import '../features/onboarding/presentation/onboarding_screen.dart';
import '../features/onboarding/providers.dart';
import '../features/outfits/presentation/outfit_detail_screen.dart';
import '../features/outfits/presentation/outfits_screen.dart';
import '../features/profile/presentation/color_profile_screen.dart';
import '../features/profile/presentation/delete_account_screen.dart';
import '../features/profile/presentation/profile_edit_screen.dart';
import '../features/profile/presentation/profile_screen.dart';
import '../features/profile/presentation/selfie_analysis_screen.dart';
import '../features/stylist/presentation/chat_screen.dart';
import '../features/stylist/presentation/stylist_screen.dart';
import '../features/stylist/providers.dart' show newChatKey;
import '../features/wardrobe/presentation/add_item_screen.dart';
import '../features/wardrobe/presentation/edit_item_screen.dart';
import '../features/wardrobe/presentation/item_detail_screen.dart';
import '../features/wardrobe/presentation/wardrobe_screen.dart';
import 'shell.dart';

/// Route paths: one per tab, the signed-out screens and onboarding.
/// Full-screen flows of later phases use [atlasFullScreenRoute]
/// (docs/architecture/mobile-app.md).
abstract final class AtlasRoutes {
  static const splash = '/splash';
  static const onboarding = '/onboarding';
  static const login = '/login';
  static const register = '/register';
  static const home = '/home';
  static const wardrobe = '/wardrobe';
  static const outfits = '/outfits';
  static const stylist = '/stylist';
  static const profile = '/profile';

  /// Full-screen flows (above the tab shell).
  static const wardrobeAdd = '/wardrobe/add';
  static String wardrobeItem(String id) => '/wardrobe/item/$id';
  static String wardrobeItemEdit(String id) => '/wardrobe/item/$id/edit';
  static String outfitDetail(String id) => '/outfits/item/$id';
  static const stylistNew = '/stylist/new';
  static const profileEdit = '/profile/edit';
  static const profileColor = '/profile/color';
  static const profileColorAnalyze = '/profile/color/analyze';
  static const profileDelete = '/profile/delete';
  static String stylistChat(String id) => '/stylist/chat/$id';
}

/// The only place that decides where the user may be, from the auth state
/// and the onboarding decision. Pure, so it is tested for every
/// state × status × location; applying it twice never moves again (no
/// Login → refresh → Login loops: refreshing keeps the user where they are,
/// only a session that ended leads to sign-in).
String? authRedirect(AuthState state, OnboardingStatus onboarding, String location) {
  final onAuthPage = location == AtlasRoutes.login || location == AtlasRoutes.register;
  String? stay(String target) => location == target ? null : target;
  return switch (state) {
    AuthRestoring() => stay(AtlasRoutes.splash),
    Unauthenticated() || SessionExpired() || Authenticating() => onAuthPage ? null : AtlasRoutes.login,
    Authenticated() || Refreshing() || LoggingOut() => switch (onboarding) {
      // Signed in, decision pending (a moment at most): keep the splash.
      OnboardingStatus.none || OnboardingStatus.checking => stay(AtlasRoutes.splash),
      OnboardingStatus.required => stay(AtlasRoutes.onboarding),
      OnboardingStatus.notRequired =>
        onAuthPage || location == AtlasRoutes.splash || location == AtlasRoutes.onboarding ? AtlasRoutes.home : null,
    },
  };
}

/// The pattern for full-screen flows above the tab shell (add item, item
/// detail, outfit detail, chat thread, …): a top-level route, so it lives on
/// the root navigator and covers the bottom bar. Open it with
/// `context.push(path)`; back returns to the tab exactly as it was. The
/// auth redirect applies to it like to every route.
GoRoute atlasFullScreenRoute({
  required String path,
  required Widget Function(BuildContext context, GoRouterState state) builder,
  bool modal = false,
}) => GoRoute(
  path: path,
  pageBuilder: (context, state) =>
      MaterialPage<void>(key: state.pageKey, fullscreenDialog: modal, child: builder(context, state)),
);

GoRouter buildRouter({
  required SessionController session,
  required OnboardingGate onboarding,
  String initialLocation = AtlasRoutes.home,
  @visibleForTesting List<RouteBase> fullScreenRoutes = const [],
}) => GoRouter(
  initialLocation: initialLocation,
  refreshListenable: Listenable.merge([session, onboarding]),
  redirect: (context, state) => authRedirect(session.state, onboarding.status, state.matchedLocation),
  routes: [
    GoRoute(path: AtlasRoutes.splash, builder: (_, _) => const SplashScreen()),
    GoRoute(path: AtlasRoutes.login, builder: (_, _) => const LoginScreen()),
    GoRoute(path: AtlasRoutes.register, builder: (_, _) => const RegisterScreen()),
    GoRoute(path: AtlasRoutes.onboarding, builder: (_, _) => const OnboardingScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.wardrobeAdd, builder: (_, _) => const AddItemScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileEdit, builder: (_, _) => const ProfileEditScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileColor, builder: (_, _) => const ColorProfileScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileColorAnalyze, builder: (_, _) => const SelfieAnalysisScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileDelete, builder: (_, _) => const DeleteAccountScreen()),
    atlasFullScreenRoute(
      path: '/wardrobe/item/:id',
      builder: (_, state) => ItemDetailScreen(id: state.pathParameters['id']!),
    ),
    atlasFullScreenRoute(
      path: '/wardrobe/item/:id/edit',
      builder: (_, state) => EditItemScreen(id: state.pathParameters['id']!),
    ),
    atlasFullScreenRoute(
      path: AtlasRoutes.stylistNew,
      builder: (_, _) => const ChatScreen(chatKey: newChatKey),
    ),
    atlasFullScreenRoute(
      path: '/stylist/chat/:id',
      builder: (_, state) => ChatScreen(chatKey: state.pathParameters['id']!),
    ),
    atlasFullScreenRoute(
      path: '/outfits/item/:id',
      builder: (_, state) => OutfitDetailScreen(id: state.pathParameters['id']!),
    ),
    ...fullScreenRoutes,
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
  final router = buildRouter(
    session: ref.watch(sessionControllerProvider),
    onboarding: ref.watch(onboardingGateProvider),
  );
  ref.onDispose(router.dispose);
  return router;
});
