import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/app/shell.dart';
import 'package:atlas_mobile/core/config/app_config.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

Future<GoRouter> pumpApp(WidgetTester tester) async {
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(
        AppConfig.fromValues(environment: 'development', apiBaseUrl: 'http://localhost:3000'),
      ),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await tester.pumpAndSettle();
  return container.read(routerProvider);
}

String location(GoRouter router) => router.routerDelegate.currentConfiguration.uri.toString();

void main() {
  testWidgets('starts on Home with five tabs in the agreed order', (tester) async {
    final router = await pumpApp(tester);
    expect(location(router), AtlasRoutes.home);
    final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(bar.destinations.length, 5);
    expect(atlasTabs.map((t) => t.label), ['Bosh sahifa', 'Garderob', 'Obrazlar', 'Stilist', 'Profil']);
    expect(bar.selectedIndex, 0);
    expect(find.text('Bugun'), findsWidgets);
  });

  testWidgets('each tab opens its screen and route', (tester) async {
    final router = await pumpApp(tester);
    const expected = {
      'Garderob': (AtlasRoutes.wardrobe, 'Kiyimlaringiz'),
      'Obrazlar': (AtlasRoutes.outfits, 'Tavsiya etilgan va saqlangan obrazlaringiz shu yerda bo‘ladi.'),
      'Stilist': (AtlasRoutes.stylist, 'AI stilist'),
      'Profil': (AtlasRoutes.profile, 'Profilingiz'),
      'Bosh sahifa': (AtlasRoutes.home, 'Kunlik tavsiyalar'),
    };
    for (final MapEntry(key: tab, value: (route, text)) in expected.entries) {
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)));
      await tester.pumpAndSettle();
      expect(location(router), route, reason: tab);
      expect(find.text(text), findsOneWidget, reason: tab);
    }
  });

  testWidgets('tabs keep their state (indexed stack): visited tabs stay mounted', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Garderob')));
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Bosh sahifa')));
    await tester.pumpAndSettle();
    // The wardrobe screen is still in the tree (offstage), not rebuilt from scratch.
    expect(find.text('Kiyimlaringiz', skipOffstage: false), findsOneWidget);
  });

  testWidgets('no overflow on a small phone with large text', (tester) async {
    tester.view.physicalSize = const Size(320 * 3, 568 * 3);
    tester.view.devicePixelRatio = 3;
    tester.platformDispatcher.textScaleFactorTestValue = 2.0; // capped to 1.6 by the app
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpApp(tester);
    expect(tester.takeException(), isNull);
  });
}
