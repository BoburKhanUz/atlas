import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/presentation/onboarding_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'onboarding_flow_test.dart' show patchOkJson, profileJson, profilePath;

/// The real app, signed in as u1 without onboarding done.
Future<(GoRouter, SessionHarness)> pumpOnboarding(WidgetTester tester, {FakeReply? patchReply}) async {
  final h = SessionHarness(stored: pair(1));
  h.backend.handlers[profilePath] = (r) =>
      r.method == 'GET' ? JsonReply(200, profileJson()) : (patchReply ?? JsonReply(200, patchOkJson()));
  final container = ProviderContainer(overrides: appOverrides(h, onboarded: false));
  addTearDown(container.dispose);
  unawaited(h.session.restore());
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await tester.pumpAndSettle();
  return (container.read(routerProvider), h);
}

String location(GoRouter r) => r.routerDelegate.currentConfiguration.uri.toString();

List<Map<String, Object?>> patches(SessionHarness h) => h.backend
    .to(profilePath)
    .where((r) => r.method == 'PATCH')
    .map((r) => jsonDecode(r.bodyText) as Map<String, Object?>)
    .toList();

Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a new user lands on onboarding; full flow sends one PATCH and opens Home', (tester) async {
    final (router, h) = await pumpOnboarding(tester);
    expect(location(router), AtlasRoutes.onboarding);
    expect(find.byType(OnboardingScreen), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    await tapKey(tester, 'onboarding.next'); // welcome → style
    await tapKey(tester, 'style.like.5'); // minimal
    await tapKey(tester, 'style.dislike.2'); // formal
    await tapKey(tester, 'onboarding.next'); // → profile
    await tapKey(tester, 'profile.gender.0'); // female
    await tapKey(tester, 'profile.fit.1'); // regular
    await tapKey(tester, 'onboarding.next'); // → colours
    await tapKey(tester, 'color.like.4'); // navy
    await tapKey(tester, 'color.dislike.22'); // mustard
    await tapKey(tester, 'onboarding.next'); // → finish
    expect(patches(h), isEmpty, reason: 'nothing is sent before Finish');
    await tapKey(tester, 'onboarding.finish');

    expect(patches(h), [
      {
        'preferences': {
          'preferredStyles': ['minimal'],
          'dislikedStyles': ['formal'],
          'favoriteColors': ['navy'],
          'dislikedColors': ['mustard'],
        },
        'profile': {'gender': 'female', 'preferredFit': 'regular'},
      },
    ]);
    expect(location(router), AtlasRoutes.home);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], 'completed');
  });

  testWidgets('Skip all leaves at once, sends nothing', (tester) async {
    final (router, h) = await pumpOnboarding(tester);
    await tapKey(tester, 'onboarding.next');
    await tapKey(tester, 'style.like.0');
    await tapKey(tester, 'onboarding.skipAll');
    expect(location(router), AtlasRoutes.home);
    expect(patches(h), isEmpty);
    expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], 'skipped');
  });

  testWidgets('Skip step moves on without that step\'s answers', (tester) async {
    final (_, h) = await pumpOnboarding(tester);
    await tapKey(tester, 'onboarding.next');
    await tapKey(tester, 'style.like.0'); // casual
    await tapKey(tester, 'onboarding.skipStep'); // style skipped → profile
    await tapKey(tester, 'onboarding.skipStep'); // → colours
    await tapKey(tester, 'color.like.0'); // white
    await tapKey(tester, 'onboarding.next');
    await tapKey(tester, 'onboarding.finish');
    expect(patches(h), [
      {
        'preferences': {
          'favoriteColors': ['white'],
        },
      },
    ]);
  });

  testWidgets('save failure: message, answers kept, retry succeeds', (tester) async {
    var calls = 0;
    final (router, h) = await pumpOnboarding(tester);
    h.backend.handlers[profilePath] = (r) {
      if (r.method == 'GET') return JsonReply(200, profileJson());
      calls++;
      return calls == 1 ? JsonReply(500, errorBody('INTERNAL')) : JsonReply(200, patchOkJson());
    };
    await tapKey(tester, 'onboarding.next');
    await tapKey(tester, 'style.like.7'); // classic
    for (var i = 0; i < 3; i++) {
      await tapKey(tester, 'onboarding.next');
    }
    await tapKey(tester, 'onboarding.finish');
    expect(find.byKey(const Key('onboarding.error')), findsOneWidget);
    expect(find.text('Qayta urinish'), findsOneWidget);
    expect(location(router), AtlasRoutes.onboarding);

    await tapKey(tester, 'onboarding.finish');
    expect(location(router), AtlasRoutes.home);
    expect(patches(h).map(jsonEncode).toSet(), hasLength(1), reason: 'the retry sends the same answers');
    expect(patches(h), hasLength(2));
  });

  testWidgets('"Add your first item" finishes and opens Wardrobe', (tester) async {
    final (router, _) = await pumpOnboarding(tester);
    for (var i = 0; i < 4; i++) {
      await tapKey(tester, 'onboarding.next');
    }
    await tapKey(tester, 'onboarding.finishToWardrobe');
    expect(location(router), AtlasRoutes.wardrobe);
  });

  testWidgets('system back goes to the previous step (answers kept)', (tester) async {
    await pumpOnboarding(tester);
    await tapKey(tester, 'onboarding.next');
    await tapKey(tester, 'style.like.1');
    await tapKey(tester, 'onboarding.next'); // profile
    expect(find.text('Siz uchun'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Uslubingiz'), findsOneWidget);
    final chip = tester.widget<FilterChip>(find.byKey(const Key('style.like.1')));
    expect(chip.selected, isTrue);
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('every step lays out without overflow ($name)', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpOnboarding(tester);
      for (var i = 0; i < 4; i++) {
        expect(tester.takeException(), isNull);
        await tapKey(tester, 'onboarding.next');
      }
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('onboarding.finish')), findsOneWidget);
    });
  }

  testWidgets('chips meet the 48 px touch target', (tester) async {
    await pumpOnboarding(tester);
    await tapKey(tester, 'onboarding.next');
    final size = tester.getSize(find.byKey(const Key('style.like.0')));
    expect(size.height, greaterThanOrEqualTo(48));
  });
}
