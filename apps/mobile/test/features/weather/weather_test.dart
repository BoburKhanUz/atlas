import 'dart:async';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/data/city_store.dart';
import 'package:atlas_mobile/features/weather/data/device_locator.dart';
import 'package:atlas_mobile/features/weather/data/location.dart';
import 'package:atlas_mobile/features/weather/presentation/weather_controller.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

import '../../support/fake_http.dart';
import '../../support/fake_location.dart';
import '../../support/fake_session.dart';
import '../outfits/outfit_fixtures.dart';

/// The platform side of geolocator, scripted (raw device coordinates).
class FakeGeolocatorPlatform extends GeolocatorPlatform {
  FakeGeolocatorPlatform(this.next);
  FutureOr<Position> Function() next;
  LocationSettings? settings;

  static Position at(double lat, double lon) => Position(
    latitude: lat,
    longitude: lon,
    timestamp: DateTime.utc(2026, 10, 5),
    accuracy: 900,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );

  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async {
    settings = locationSettings;
    return next();
  }
}

class Weather {
  Weather({DateTime? now}) {
    clock = now ?? DateTime.utc(2026, 10, 5, 10, 5);
    c = ProviderContainer(overrides: [...appOverrides(h), weatherClockProvider.overrideWithValue(() => clock)]);
    addTearDown(c.dispose);
  }

  final h = SessionHarness(stored: pair(1));
  late final ProviderContainer c;
  late DateTime clock;

  WeatherController get ctl => c.read(weatherControllerProvider.notifier);
  WeatherState get state => c.read(weatherControllerProvider);
  List<SentRequest> get weatherCalls => h.backend.to(P.weather);

  Future<void> start() async {
    await h.session.restore();
    c.listen(weatherControllerProvider, (_, _) {});
    h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.utc(2026, 10, 5, 10)))]);
  }
}

void main() {
  group('coordinate rounding (round → validate → send)', () {
    test('2 decimal places', () {
      final r = RoundedLocation.round(41.311234567, 69.284999)!;
      expect((r.lat, r.lon), (41.31, 69.28));
      expect(RoundedLocation.round(-12.345678, -77.0049)!.lat, -12.35);
      expect(RoundedLocation.round(69.285001, 0)!.lat, 69.29);
      expect(RoundedLocation.round(0.004, -0.004)!.cell, '0.00,-0.00');
    });

    test('the ROUNDED value is validated (edges)', () {
      expect(RoundedLocation.round(90.004, 180.004), isNotNull, reason: 'rounds to 90.00 / 180.00');
      expect(RoundedLocation.round(-90.004, -180.004), isNotNull);
      expect(RoundedLocation.round(90.006, 0), isNull, reason: 'rounds to 90.01');
      expect(RoundedLocation.round(0, 180.006), isNull);
      expect(RoundedLocation.round(0, -180.006), isNull);
      expect(RoundedLocation.round(double.nan, 0), isNull);
      expect(RoundedLocation.round(0, double.infinity), isNull);
    });

    test('never prints coordinates', () {
      final r = RoundedLocation.round(41.311234, 69.28)!;
      expect(r.toString(), isNot(contains('41')));
      expect(r.toString(), isNot(contains('69')));
    });

    test('the platform adapter rounds the raw position before it leaves; low accuracy, bounded', () async {
      final previous = GeolocatorPlatform.instance;
      addTearDown(() => GeolocatorPlatform.instance = previous);
      final platform = FakeGeolocatorPlatform(() => FakeGeolocatorPlatform.at(41.3112345678, 69.2798765432));
      GeolocatorPlatform.instance = platform;
      final result = await PlatformDeviceLocator().currentLocation(const Duration(seconds: 10));
      expect(result, isA<Located>().having((l) => (l.location.lat, l.location.lon), 'rounded', (41.31, 69.28)));
      expect(platform.settings!.accuracy, LocationAccuracy.low);
      expect(platform.settings!.timeLimit, const Duration(seconds: 10));

      platform.next = () => FakeGeolocatorPlatform.at(95.12345, 10);
      expect(await PlatformDeviceLocator().currentLocation(const Duration(seconds: 1)), isA<NotLocated>());
      platform.next = () => throw TimeoutException('t');
      expect(
        await PlatformDeviceLocator().currentLocation(const Duration(seconds: 1)),
        isA<NotLocated>().having((n) => n.issue, 'issue', LocationIssue.timeout),
      );
      platform.next = () => throw const LocationServiceDisabledException();
      expect(
        await PlatformDeviceLocator().currentLocation(const Duration(seconds: 1)),
        isA<NotLocated>().having((n) => n.issue, 'issue', LocationIssue.serviceDisabled),
      );
      platform.next = () => throw const PermissionDeniedException('denied');
      expect(
        await PlatformDeviceLocator().currentLocation(const Duration(seconds: 1)),
        isA<NotLocated>().having((n) => n.issue, 'issue', LocationIssue.denied),
      );
    });

    test('a platform error carrying coordinates never reaches the log', () async {
      final previous = GeolocatorPlatform.instance;
      final lines = <String>[];
      final sink = AppLog.sink;
      final policy = AppLog.policy;
      AppLog.sink = lines.add;
      AppLog.policy = LogPolicy.verbose;
      addTearDown(() {
        GeolocatorPlatform.instance = previous;
        AppLog.sink = sink;
        AppLog.policy = policy;
      });
      GeolocatorPlatform.instance = FakeGeolocatorPlatform(() => throw StateError('fix at 41.3112345,69.2798765'));
      await PlatformDeviceLocator().currentLocation(const Duration(seconds: 1));
      expect(lines, isNotEmpty);
      expect(lines.join('\n'), isNot(contains('41.31')));
    });
  });

  group('cities and the per-user city preference', () {
    test('city list: unique ids, valid rounded coordinates', () {
      expect(Cities.all.map((c) => c.id).toSet(), hasLength(Cities.all.length));
      for (final c in Cities.all) {
        expect(c.location, isNotNull);
      }
      expect(Cities.byId('nowhere'), isNull);
    });

    test('only the city id is stored, under a per-user key; users never share it', () async {
      final kv = MemorySecureStore();
      final store = CityStore(kv);
      await store.save('u1', Cities.byId('samarkand')!);
      expect(kv.values, {'atlas.weather.city.u1': 'samarkand'});
      expect((await store.read('u1'))!.id, 'samarkand');
      expect(await store.read('u2'), isNull);
      await store.clear('u1');
      expect(kv.values, isEmpty);
    });

    test('an unknown stored id → no city; storage failures never throw', () async {
      final kv = MemorySecureStore()..values['atlas.weather.city.u1'] = 'atlantis';
      expect(await CityStore(kv).read('u1'), isNull);
      kv
        ..failReads = true
        ..failWrites = true
        ..failDeletes = true;
      final store = CityStore(kv);
      expect(await store.read('u1'), isNull);
      await store.save('u1', Cities.all.first);
      await store.clear('u1');
    });
  });

  group('freshness', () {
    test('fresh until 30 min after the server fetchedAt; stale at exactly 30 min', () async {
      final w = Weather();
      await w.start();
      await w.ctl.chooseCity(Cities.all.first);
      final fetched = w.state.weather!.fetchedAt;
      expect(WeatherFreshness.isFresh(w.state.weather!, fetched.add(const Duration(minutes: 29, seconds: 59))), isTrue);
      expect(WeatherFreshness.isFresh(w.state.weather!, fetched.add(const Duration(minutes: 30))), isFalse);
    });
  });

  group('location state machine', () {
    test('Home opening never prompts: permission not asked → idle, no read, no request', () async {
      final w = Weather();
      await w.start();
      await w.ctl.refreshIfStale();
      expect(w.state.status, WeatherStatus.idle);
      expect(w.h.locator.requests, 0);
      expect(w.h.locator.reads, 0);
      expect(w.weatherCalls, isEmpty);
    });

    test('permission already granted → one read, the ROUNDED location is sent, ready', () async {
      final w = Weather();
      w.h.locator.current = LocationAccess.granted;
      await w.start();
      await w.ctl.refreshIfStale();
      expect(w.h.locator.reads, 1);
      expect(w.h.locator.requests, 0);
      expect(w.weatherCalls.single.uri.queryParameters, {'lat': '41.31', 'lon': '69.28'});
      expect(w.state.status, WeatherStatus.ready);
      expect(w.state.source, LocationSource.device);
    });

    test('user taps → prompt once → granted → weather', () async {
      final w = Weather();
      await w.start();
      await w.ctl.locate();
      expect(w.h.locator.requests, 1);
      expect(w.state.status, WeatherStatus.ready);
    });

    for (final (name, setup, issue) in [
      ('denied', (FakeLocator l) => l.onRequest = LocationAccess.denied, LocationIssue.denied),
      ('permanently denied', (FakeLocator l) => l.current = LocationAccess.deniedForever, LocationIssue.deniedForever),
      ('service disabled', (FakeLocator l) => l.service = false, LocationIssue.serviceDisabled),
      ('timeout', (FakeLocator l) => l.result = const NotLocated(LocationIssue.timeout), LocationIssue.timeout),
      (
        'unavailable',
        (FakeLocator l) => l.result = const NotLocated(LocationIssue.unavailable),
        LocationIssue.unavailable,
      ),
    ]) {
      test('$name → noLocation($name), manual city offered, no weather request', () async {
        final w = Weather();
        setup(w.h.locator);
        await w.start();
        await w.ctl.locate();
        expect(w.state.status, WeatherStatus.noLocation);
        expect(w.state.issue, issue);
        expect(w.weatherCalls, isEmpty);
      });
    }

    test('permanently denied / service off: no prompt; settings can be opened', () async {
      final w = Weather();
      w.h.locator.current = LocationAccess.deniedForever;
      await w.start();
      await w.ctl.locate();
      expect(w.h.locator.requests, 0);
      await w.ctl.openSettings();
      expect(w.h.locator.settingsOpened, 1);
    });

    test('automatic paths prompt at most once per session; "use my location" may ask again', () async {
      final w = Weather();
      w.h.locator.onRequest = LocationAccess.denied;
      await w.start();
      await w.ctl.locate();
      w.h.locator.current = LocationAccess.notDetermined;
      await w.ctl.locate();
      expect(w.h.locator.requests, 1);
      w.h.locator.onRequest = LocationAccess.granted;
      await w.ctl.useDeviceLocation();
      expect(w.h.locator.requests, 2);
      expect(w.state.status, WeatherStatus.ready);
    });

    test('double tap → one location flow, one request', () async {
      final w = Weather();
      w.h.locator.current = LocationAccess.granted;
      await w.start();
      await Future.wait([w.ctl.locate(), w.ctl.locate()]);
      expect(w.h.locator.reads, 1);
      expect(w.weatherCalls, hasLength(1));
    });
  });

  group('manual city', () {
    test('choosing a city stores its id for this user and fetches the city weather; the device is not used', () async {
      final w = Weather();
      await w.start();
      await w.ctl.chooseCity(Cities.byId('bukhara')!);
      expect(w.h.kv.values['atlas.weather.city.u1'], 'bukhara');
      expect(w.weatherCalls.single.uri.queryParameters, {'lat': '39.77', 'lon': '64.42'});
      expect(w.state.source, LocationSource.city);
      expect(w.h.locator.reads + w.h.locator.requests, 0);
    });

    test('next app run: the stored city is used without any location prompt', () async {
      final w = Weather();
      w.h.kv.values['atlas.weather.city.u1'] = 'namangan';
      await w.start();
      await w.ctl.refreshIfStale();
      expect(w.state.city!.id, 'namangan');
      expect(w.weatherCalls.single.uri.queryParameters, {'lat': '41.0', 'lon': '71.67'});
      expect(w.h.locator.reads + w.h.locator.requests, 0);
    });

    test('another user\'s city is never used', () async {
      final w = Weather();
      w.h.kv.values['atlas.weather.city.u2'] = 'namangan';
      await w.start();
      await w.ctl.refreshIfStale();
      expect(w.state.city, isNull);
      expect(w.weatherCalls, isEmpty);
    });

    test('"use my location" forgets the city', () async {
      final w = Weather();
      w.h.kv.values['atlas.weather.city.u1'] = 'namangan';
      await w.start();
      await w.ctl.useDeviceLocation();
      expect(w.h.kv.values.containsKey('atlas.weather.city.u1'), isFalse);
      expect(w.state.source, LocationSource.device);
    });

    test('nothing but the city id is persisted (no coordinates, no weather)', () async {
      final w = Weather();
      w.h.locator.current = LocationAccess.granted;
      await w.start();
      await w.ctl.refreshIfStale();
      await w.ctl.chooseCity(Cities.byId('termez')!);
      final stored = w.h.kv.values.entries.where(
        (e) => !e.key.startsWith('atlas.session') && !e.key.startsWith('atlas.onboarding'),
      );
      expect(Map.fromEntries(stored), {'atlas.weather.city.u1': 'termez'});
    });
  });

  group('in-memory cache', () {
    test('fresh weather is reused; stale after 30 min → one new request; pull-to-refresh asks again', () async {
      final w = Weather();
      await w.start();
      await w.ctl.chooseCity(Cities.all.first);
      await w.ctl.refreshIfStale();
      expect(w.weatherCalls, hasLength(1));
      w.clock = DateTime.utc(2026, 10, 5, 10, 30); // fetchedAt 10:00 + 30 min
      expect(w.ctl.isStale, isTrue);
      w.h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.utc(2026, 10, 5, 10, 30)))]);
      await w.ctl.refreshIfStale();
      expect(w.weatherCalls, hasLength(2));
      expect(w.ctl.isStale, isFalse);
      await w.ctl.refresh();
      expect(w.weatherCalls, hasLength(3));
    });

    test('switching back to a city within 30 min reuses its cached weather (no request)', () async {
      final w = Weather();
      await w.start();
      await w.ctl.chooseCity(Cities.byId('bukhara')!);
      await w.ctl.chooseCity(Cities.byId('nukus')!);
      await w.ctl.chooseCity(Cities.byId('bukhara')!);
      expect(w.weatherCalls.map((r) => r.uri.queryParameters['lat']), ['39.77', '42.46']);
      expect(w.state.status, WeatherStatus.ready);
    });

    test('a failed refresh keeps the stale weather visible (marked stale)', () async {
      final w = Weather();
      await w.start();
      await w.ctl.chooseCity(Cities.all.first);
      final before = w.state.weather;
      w.clock = DateTime.utc(2026, 10, 5, 11);
      w.h.backend.script(P.weather, [JsonReply(500, errorBody('INTERNAL'))]);
      await w.ctl.refreshIfStale();
      expect(w.state.status, WeatherStatus.failed);
      expect(w.state.weather, before);
      expect(w.ctl.isStale, isTrue);
      expect(w.ctl.freshWeather, isNull, reason: 'stale weather is never sent to outfit generation');
    });

    test('offline: the read is retried by the shared policy, then fails without losing data', () async {
      final w = Weather();
      await w.start();
      w.h.backend.script(P.weather, [TransportFailure(DioExceptionType.connectionError)]);
      await w.ctl.chooseCity(Cities.all.first);
      expect(w.state.status, WeatherStatus.failed);
      expect(w.weatherCalls.length, greaterThan(1), reason: 'GET: safe automatic retry');
    });
  });
}
