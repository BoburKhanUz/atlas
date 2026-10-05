import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/app/shell.dart';
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/connectivity.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/session/session_interceptor.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../support/fake_http.dart';
import '../support/fake_session.dart';

Future<GoRouter> pumpApp(WidgetTester tester, {FakeDeviceNetwork? network}) async {
  final storage = MemorySecureStore()..put(livePair(1));
  markOnboarded(storage);
  final container = ProviderContainer(
    overrides: [
      environmentConfigProvider.overrideWithValue(
        AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: 'http://localhost:3000'),
      ),
      deviceNetworkProvider.overrideWithValue(network ?? FakeDeviceNetwork()),
      // Signed in: a valid session in (fake) secure storage.
      secureKeyValueStoreProvider.overrideWithValue(storage),
      // The production HTTP stack, answered by a fake backend.
      dioProvider.overrideWith(
        (ref) => buildAtlasDio(
          config: ref.watch(environmentConfigProvider),
          tokens: ref.watch(accessTokenSourceProvider),
          reachability: ref.watch(apiReachabilityProvider),
          adapter: FakeBackend()
            ..script(P.wardrobe, [
              JsonReply(200, {'items': <Object>[], 'nextCursor': null}),
            ]),
          session: (dio) => AtlasSessionInterceptor(ref.watch(sessionControllerProvider), dio),
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await tester.pumpAndSettle();
  return container.read(routerProvider);
}

class FakeDeviceNetwork implements DeviceNetwork {
  FakeDeviceNetwork({this.online = true});
  bool online;
  final controller = StreamController<bool>.broadcast();
  @override
  Future<bool> hasNetwork() async => online;
  @override
  Stream<bool> get changes => controller.stream;
  void set(bool value) {
    online = value;
    controller.add(value);
  }
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
      'Garderob': (AtlasRoutes.wardrobe, 'Garderob bo‘sh'),
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
    expect(find.text('Garderob bo‘sh', skipOffstage: false), findsOneWidget);
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

  testWidgets('offline banner appears when the device loses network and disappears when it returns', (tester) async {
    final network = FakeDeviceNetwork();
    await pumpApp(tester, network: network);
    expect(find.text('Internet aloqasi yo‘q'), findsNothing);
    network.set(false);
    await tester.pumpAndSettle();
    expect(find.text('Internet aloqasi yo‘q'), findsOneWidget);
    network.set(true);
    await tester.pumpAndSettle();
    expect(find.text('Internet aloqasi yo‘q'), findsNothing);
  });
}
