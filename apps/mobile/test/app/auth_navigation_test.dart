import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/auth/presentation/splash_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../support/fake_http.dart';
import '../support/fake_session.dart';

/// Pumps the real app with [h]'s session (fake backend, fake storage).
Future<GoRouter> pumpWithSession(WidgetTester tester, SessionHarness h) async {
  final container = ProviderContainer(overrides: appOverrides(h));
  addTearDown(container.dispose);
  unawaited(h.session.restore());
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await tester.pumpAndSettle();
  return container.read(routerProvider);
}

/// Real-time wait (inside `tester.runAsync`) until [done] holds; 5 s max.
Future<void> waitFor(bool Function() done) async {
  for (var i = 0; i < 500 && !done(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

String location(GoRouter router) => router.routerDelegate.currentConfiguration.uri.toString();

void main() {
  group('app navigation', () {
    testWidgets('no stored session → sign-in screen', (tester) async {
      final h = SessionHarness();
      final router = await pumpWithSession(tester, h);
      expect(location(router), AtlasRoutes.login);
      expect(find.byKey(const Key('login.submit')), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets('splash while the session is restored, then Home', (tester) async {
      final h = SessionHarness(stored: pair(1));
      final container = ProviderContainer(overrides: appOverrides(h));
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
      await tester.pump(const Duration(milliseconds: 100));
      final router = container.read(routerProvider);
      expect(h.session.state, const AuthRestoring());
      expect(location(router), AtlasRoutes.splash);
      expect(find.byType(SplashScreen), findsOneWidget);

      unawaited(h.session.restore());
      await tester.pump();
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.home);
      expect(find.byType(SplashScreen), findsNothing);
    });

    testWidgets('sign in → Home; empty fields are rejected before any request', (tester) async {
      final h = SessionHarness();
      h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
      final router = await pumpWithSession(tester, h);

      await tester.tap(find.byKey(const Key('login.submit')));
      await tester.pumpAndSettle();
      expect(find.text('Emailni kiriting'), findsOneWidget);
      expect(h.backend.calls(P.login), 0);

      await tester.enterText(find.byKey(const Key('login.email')), 'a@test.local');
      await tester.enterText(find.byKey(const Key('login.password')), 'secret-pw');
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('login.submit')));
        await waitFor(() => h.backend.calls(P.login) == 1 && h.session.state is! Authenticating);
      });
      await tester.pumpAndSettle();
      expect(h.backend.calls(P.login), 1);
      expect(location(router), AtlasRoutes.home);
      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('wrong password: message on the sign-in screen, still signed out', (tester) async {
      final h = SessionHarness();
      h.backend.script(P.login, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final router = await pumpWithSession(tester, h);
      await tester.enterText(find.byKey(const Key('login.email')), 'a@test.local');
      await tester.enterText(find.byKey(const Key('login.password')), 'wrong');
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('login.submit')));
        await waitFor(() => h.backend.calls(P.login) == 1 && h.session.state is! Authenticating);
      });
      await tester.pumpAndSettle();
      expect(find.text('Email yoki parol noto‘g‘ri.'), findsOneWidget);
      expect(location(router), AtlasRoutes.login);
    });

    testWidgets('register link and back', (tester) async {
      final h = SessionHarness();
      final router = await pumpWithSession(tester, h);
      await tester.tap(find.byKey(const Key('login.toRegister')));
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.register);
      await tester.tap(find.byKey(const Key('register.toLogin')));
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.login);
    });

    testWidgets('REFRESH_REUSED while signed in → sign-in with an explanation, no loop', (tester) async {
      final h = SessionHarness(stored: pair(1));
      final router = await pumpWithSession(tester, h);
      expect(location(router), AtlasRoutes.home);

      h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await tester.runAsync(h.tryMe);
      await tester.pumpAndSettle();

      expect(location(router), AtlasRoutes.login);
      expect(find.text('Xavfsizlik uchun sessiya yakunlandi. Iltimos, qayta kiring.'), findsOneWidget);
      // Settled: no further refresh, no bouncing between routes.
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.login);
      expect(h.backend.calls(P.refresh), 1);
      expect(h.backend.calls(P.logout), 0);
    });

    testWidgets('a refresh does not navigate (user stays on their tab)', (tester) async {
      final h = SessionHarness(stored: pair(1));
      final router = await pumpWithSession(tester, h);
      router.go(AtlasRoutes.wardrobe);
      await tester.pumpAndSettle();
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await tester.runAsync(h.tryMe);
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.wardrobe);
    });

    testWidgets('logout from Profile → sign-in; tokens gone', (tester) async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(P.logout, [
        JsonReply(200, {'ok': true}),
      ]);
      final router = await pumpWithSession(tester, h);
      router.go(AtlasRoutes.profile);
      await tester.pumpAndSettle();
      expect(find.text('a@test.local'), findsOneWidget);
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('profile.logout')));
        await waitFor(() => h.session.state is Unauthenticated);
      });
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.login);
      expect(h.kv.values.containsKey('atlas.session.v1'), isFalse, reason: 'tokens gone');
      expect(h.backend.calls(P.logout), 1);
    });
  });
}
