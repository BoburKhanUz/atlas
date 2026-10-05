import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/widgets/atlas_page.dart';
import 'package:atlas_mobile/core/widgets/tab_reselect.dart';
import 'package:atlas_mobile/features/onboarding/providers.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../support/fake_http.dart';
import '../support/fake_session.dart';

/// A full-screen route of a later phase, registered with the real pattern.
final _itemRoute = atlasFullScreenRoute(
  path: '/item/:id',
  builder: (context, state) => Scaffold(
    appBar: AppBar(title: Text('Item ${state.pathParameters['id']}')),
    body: const SizedBox.shrink(),
  ),
);

Future<(GoRouter, SessionHarness)> pumpSignedIn(WidgetTester tester) async {
  final h = SessionHarness(stored: pair(1));
  final container = ProviderContainer(
    overrides: [
      ...appOverrides(h),
      routerProvider.overrideWith((ref) {
        final router = buildRouter(
          session: ref.watch(sessionControllerProvider),
          onboarding: ref.watch(onboardingGateProvider),
          fullScreenRoutes: [_itemRoute],
        );
        ref.onDispose(router.dispose);
        return router;
      }),
    ],
  );
  addTearDown(container.dispose);
  unawaited(h.session.restore());
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await tester.pumpAndSettle();
  return (container.read(routerProvider), h);
}

String location(GoRouter r) => r.routerDelegate.currentConfiguration.uri.toString();

Future<void> tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
  await tester.pumpAndSettle();
}

/// Records SystemNavigator.pop (the app leaving on Android back).
List<String> recordSystemPops(WidgetTester tester) {
  final calls = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
    if (call.method == 'SystemNavigator.pop') calls.add(call.method);
    return null;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return calls;
}

double scrollOffset(WidgetTester tester) =>
    tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;

void main() {
  group('Android back', () {
    testWidgets('on another tab → Home (the app stays open)', (tester) async {
      final pops = recordSystemPops(tester);
      final (router, _) = await pumpSignedIn(tester);
      for (final (label, route) in [
        ('Garderob', AtlasRoutes.wardrobe),
        ('Stilist', AtlasRoutes.stylist),
        ('Profil', AtlasRoutes.profile),
      ]) {
        await tapTab(tester, label);
        expect(location(router), route);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(location(router), AtlasRoutes.home, reason: label);
      }
      expect(pops, isEmpty);
    });

    testWidgets('on Home → the app exits', (tester) async {
      final pops = recordSystemPops(tester);
      final (router, _) = await pumpSignedIn(tester);
      expect(location(router), AtlasRoutes.home);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(pops, ['SystemNavigator.pop']);
    });

    testWidgets('on a full-screen route → back to the tab it was opened from', (tester) async {
      final pops = recordSystemPops(tester);
      final (router, _) = await pumpSignedIn(tester);
      await tapTab(tester, 'Garderob');
      unawaited(router.push('/item/42'));
      await tester.pumpAndSettle();
      expect(find.text('Item 42'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(location(router), AtlasRoutes.wardrobe);
      expect(pops, isEmpty);
    });
  });

  group('full-screen route pattern', () {
    testWidgets('covers the bottom bar; the tab underneath keeps its state', (tester) async {
      final (router, _) = await pumpSignedIn(tester);
      await tapTab(tester, 'Garderob');
      unawaited(router.push('/item/7'));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.text('Item 7'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(location(router), AtlasRoutes.wardrobe);
    });

    testWidgets('the auth rule applies: a session that ends leaves the full-screen route for sign-in', (tester) async {
      final (router, h) = await pumpSignedIn(tester);
      unawaited(router.push('/item/1'));
      await tester.pumpAndSettle();
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_REVOKED'))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await tester.runAsync(h.tryMe);
      await tester.pumpAndSettle();
      expect(h.session.state, const SessionExpired(SignedOutReason.revoked));
      expect(location(router), AtlasRoutes.login);
    });
  });

  group('re-tapping the active tab', () {
    testWidgets('scrolls the tab page back to the top', (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 480 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await pumpSignedIn(tester);
      final outer = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
      outer.jumpTo(outer.maxScrollExtent);
      await tester.pump();
      expect(scrollOffset(tester), greaterThan(0));
      await tapTab(tester, 'Bosh sahifa'); // active tab tapped again
      expect(scrollOffset(tester), 0);
    });

    testWidgets('only the active, top-most tab page reacts', (tester) async {
      final taps = ValueNotifier<int>(0);
      final active = ScrollController();
      Widget page(String title, {required bool enabled}) => TickerMode(
        enabled: enabled,
        child: AtlasPage(
          title: title,
          slivers: [
            SliverList.list(children: [for (var i = 0; i < 40; i++) SizedBox(height: 60, child: Text('$title $i'))]),
          ],
        ),
      );
      // Reduced motion: scrolling is a jump, so an inactive page (whose
      // tickers are off) would visibly move if it reacted.
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: MaterialApp(
            home: TabReselect(
              taps: taps,
              child: Column(
                children: [
                  Expanded(child: page('A', enabled: true)),
                  Expanded(child: page('B', enabled: false)),
                ],
              ),
            ),
          ),
        ),
      );
      final scrollables = find.byType(Scrollable);
      for (final i in [0, 1]) {
        tester.state<ScrollableState>(scrollables.at(i)).position.jumpTo(400);
      }
      await tester.pump();
      taps.value++;
      await tester.pumpAndSettle();
      expect(tester.state<ScrollableState>(scrollables.at(0)).position.pixels, 0);
      expect(tester.state<ScrollableState>(scrollables.at(1)).position.pixels, 400);
      active.dispose();
    });

    testWidgets('with reduced motion it jumps (no animation)', (tester) async {
      final taps = ValueNotifier<int>(0);
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: MaterialApp(
            home: TabReselect(
              taps: taps,
              child: AtlasPage(
                title: 'A',
                slivers: [
                  SliverList.list(children: [for (var i = 0; i < 40; i++) SizedBox(height: 60, child: Text('row $i'))]),
                ],
              ),
            ),
          ),
        ),
      );
      tester.state<ScrollableState>(find.byType(Scrollable)).position.jumpTo(500);
      await tester.pump();
      taps.value++;
      await tester.pump(); // a single frame, no animation needed
      expect(tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels, 0);
    });
  });
}
