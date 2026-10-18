import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/logging/crash_reporter.dart';
import '../core/session/auth_state.dart';
import '../core/session/providers.dart';
import '../core/session/session_controller.dart';
import '../features/auth/presentation/forgot_password_screen.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/register_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/legal/consent_gate.dart';
import '../features/legal/data/legal_repository.dart' show LegalDocumentKind;
import '../features/legal/presentation/consent_screen.dart';
import '../features/legal/presentation/legal_document_screen.dart';
import '../features/legal/providers.dart';
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

  /// Requests the e-mailed reset link (the link opens the web page that sets
  /// the new password; the app then signs in with it).
  static const forgotPassword = '/forgot-password';
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

  /// The changed legal texts to accept before anything else (ConsentGate).
  static const consent = '/consent';

  /// The legal documents: readable signed out too (the register screen links them).
  static const privacy = '/legal/privacy';
  static const terms = '/legal/terms';
  static String legal(LegalDocumentKind kind) => switch (kind) {
    LegalDocumentKind.privacy => privacy,
    LegalDocumentKind.terms => terms,
  };
}

/// The only place that decides where the user may be, from the auth state,
/// the consent decision and the onboarding decision. Pure, so it is tested for every
/// state × status × location; applying it twice never moves again (no
/// Login → refresh → Login loops: refreshing keeps the user where they are,
/// only a session that ended leads to sign-in).
String? authRedirect(AuthState state, ConsentStatus consent, OnboardingStatus onboarding, String location) {
  final onAuthPage =
      location == AtlasRoutes.login || location == AtlasRoutes.register || location == AtlasRoutes.forgotPassword;
  final onLegalPage = location == AtlasRoutes.privacy || location == AtlasRoutes.terms;
  String? stay(String target) => location == target ? null : target;
  return switch (state) {
    AuthRestoring() => stay(AtlasRoutes.splash),
    Unauthenticated() || SessionExpired() || Authenticating() => onAuthPage || onLegalPage ? null : AtlasRoutes.login,
    Authenticated() || Refreshing() || LoggingOut() => switch (consent) {
      // Signed in, decisions pending (a moment at most): keep the splash.
      ConsentStatus.none || ConsentStatus.checking => stay(AtlasRoutes.splash),
      // The texts to accept, readable from there; declining = deleting the account.
      ConsentStatus.required => onLegalPage || location == AtlasRoutes.profileDelete ? null : stay(AtlasRoutes.consent),
      ConsentStatus.notRequired => switch (onboarding) {
        OnboardingStatus.none || OnboardingStatus.checking => stay(AtlasRoutes.splash),
        OnboardingStatus.required => stay(AtlasRoutes.onboarding),
        OnboardingStatus.notRequired =>
          onAuthPage ||
                  location == AtlasRoutes.splash ||
                  location == AtlasRoutes.onboarding ||
                  location == AtlasRoutes.consent
              ? AtlasRoutes.home
              : null,
      },
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
  required ConsentGate consent,
  required OnboardingGate onboarding,
  String initialLocation = AtlasRoutes.home,
  @visibleForTesting List<RouteBase> fullScreenRoutes = const [],
}) => GoRouter(
  initialLocation: initialLocation,
  refreshListenable: Listenable.merge([session, consent, onboarding]),
  redirect: (context, state) => authRedirect(session.state, consent.status, onboarding.status, state.matchedLocation),
  routes: [
    GoRoute(path: AtlasRoutes.splash, builder: (_, _) => const SplashScreen()),
    GoRoute(path: AtlasRoutes.login, builder: (_, _) => const LoginScreen()),
    GoRoute(path: AtlasRoutes.register, builder: (_, _) => const RegisterScreen()),
    GoRoute(path: AtlasRoutes.forgotPassword, builder: (_, _) => const ForgotPasswordScreen()),
    GoRoute(path: AtlasRoutes.onboarding, builder: (_, _) => const OnboardingScreen()),
    GoRoute(path: AtlasRoutes.consent, builder: (_, _) => const ConsentScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.wardrobeAdd, builder: (_, _) => const AddItemScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileEdit, builder: (_, _) => const ProfileEditScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileColor, builder: (_, _) => const ColorProfileScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileColorAnalyze, builder: (_, _) => const SelfieAnalysisScreen()),
    atlasFullScreenRoute(path: AtlasRoutes.profileDelete, builder: (_, _) => const DeleteAccountScreen()),
    for (final kind in LegalDocumentKind.values)
      atlasFullScreenRoute(
        path: AtlasRoutes.legal(kind),
        builder: (_, _) => LegalDocumentScreen(kind: kind),
      ),
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
    consent: ref.watch(consentGateProvider),
    onboarding: ref.watch(onboardingGateProvider),
  );
  ref.read(crashReporterProvider)?.currentRoute = () => router.routerDelegate.currentConfiguration.uri.path;
  ref.onDispose(router.dispose);
  return router;
});
