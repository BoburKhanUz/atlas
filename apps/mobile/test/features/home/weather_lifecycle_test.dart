import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/features/weather/data/city_store.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../outfits/outfit_fixtures.dart';

/// Home in the real app, with a controllable clock. Weather is fetched at
/// 10:00 (server fetchedAt) for the user's stored city.
class HomeApp {
  HomeApp(this.tester);
  final WidgetTester tester;
  final h = SessionHarness(stored: livePair(1));
  DateTime clock = DateTime.utc(2026, 10, 5, 10, 1);

  int get weatherCalls => h.backend.calls(P.weather);
  String? get temp => tester.widgetList<Text>(find.byKey(const Key('weather.temp'))).firstOrNull?.data;
  bool get staleShown => find.byKey(const Key('weather.stale')).evaluate().isNotEmpty;

  Future<void> start({String? city = 'tashkent'}) async {
    if (city != null) h.kv.values[CityStore.keyFor('u1')] = city;
    h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.utc(2026, 10, 5, 10)))]);
    final container = ProviderContainer(
      overrides: [...appOverrides(h), weatherClockProvider.overrideWithValue(() => clock)],
    );
    addTearDown(container.dispose);
    unawaited(h.session.restore());
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
    await settle();
  }

  Future<void> settle() async {
    for (var i = 0; i < 25; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 2)));
    }
  }

  /// Background → foreground, through every intermediate state, the way the
  /// platform reports it.
  Future<void> backgroundAndResume() async {
    for (final s in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(s);
      await tester.pump();
    }
    await settle();
  }
}

void main() {
  testWidgets('resume with FRESH weather: nothing is refetched', (tester) async {
    final app = HomeApp(tester);
    await app.start();
    expect(app.weatherCalls, 1, reason: 'Home loads the stored city once');
    expect(app.temp, '18°');

    app.clock = DateTime.utc(2026, 10, 5, 10, 29); // fetchedAt + 29 min: still fresh
    await app.backgroundAndResume();
    expect(app.weatherCalls, 1);
    expect(app.staleShown, isFalse);
  });

  testWidgets('resume with STALE weather: exactly one refresh, new weather shown', (tester) async {
    final app = HomeApp(tester);
    await app.start();
    app.clock = DateTime.utc(2026, 10, 5, 10, 31); // > 30 min
    app.h.backend.script(P.weather, [
      JsonReply(200, weatherJson(fetchedAt: DateTime.utc(2026, 10, 5, 10, 31), temperature: 24)),
    ]);
    await app.backgroundAndResume();
    expect(app.weatherCalls, 2);
    expect(app.temp, '24°');
    expect(app.staleShown, isFalse);

    // Resuming again right away: the new weather is fresh.
    await app.backgroundAndResume();
    expect(app.weatherCalls, 2);
  });

  testWidgets('resume with stale weather and a FAILED refresh: the stale weather stays visible, marked', (
    tester,
  ) async {
    final app = HomeApp(tester);
    await app.start();
    app.clock = DateTime.utc(2026, 10, 5, 11);
    app.h.backend.script(P.weather, [JsonReply(500, errorBody('INTERNAL'))]);
    await app.backgroundAndResume();
    expect(app.weatherCalls, 2, reason: 'one attempt (5xx on a GET is not an offline retry)');
    expect(app.temp, '18°', reason: 'the last weather is kept, not cleared');
    expect(app.staleShown, isTrue);
  });

  testWidgets('resume without a city or permission: no prompt, no request', (tester) async {
    final app = HomeApp(tester);
    await app.start(city: null);
    await app.backgroundAndResume();
    expect(app.h.locator.requests, 0);
    expect(app.weatherCalls, 0);
  });
}
