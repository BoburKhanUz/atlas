import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show WeatherResponseWeather;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../data/cities.dart';
import '../data/device_locator.dart';
import '../data/location.dart';
import '../providers.dart';

/// Where the location comes from.
enum LocationSource { device, city }

enum WeatherStatus {
  /// Location never asked for: the user is offered a choice (no prompt yet).
  idle,
  locating,
  loading,
  ready,

  /// No location (see [WeatherState.issue]): manual city is offered.
  noLocation,

  /// The weather request failed (stale data, if any, stays visible).
  failed,
}

@immutable
class WeatherState {
  const WeatherState({
    this.status = WeatherStatus.idle,
    this.source,
    this.city,
    this.issue,
    this.weather,
    this.failure,
  });

  final WeatherStatus status;
  final LocationSource? source;
  final City? city;
  final LocationIssue? issue;

  /// The last weather shown (kept when a refresh fails).
  final WeatherResponseWeather? weather;
  final ApiFailure? failure;

  WeatherState copyWith({
    WeatherStatus? status,
    LocationSource? source,
    City? Function()? city,
    LocationIssue? Function()? issue,
    WeatherResponseWeather? Function()? weather,
    ApiFailure? Function()? failure,
  }) => WeatherState(
    status: status ?? this.status,
    source: source ?? this.source,
    city: city == null ? this.city : city(),
    issue: issue == null ? this.issue : issue(),
    weather: weather == null ? this.weather : weather(),
    failure: failure == null ? this.failure : failure(),
  );
}

/// Weather is fresh for 30 minutes from the server's `fetchedAt` (the
/// server caches per cell for the same time).
abstract final class WeatherFreshness {
  static const lifetime = Duration(minutes: 30);
  static const locationTimeout = Duration(seconds: 10);

  static bool isFresh(WeatherResponseWeather w, DateTime now) =>
      now.toUtc().isBefore(w.fetchedAt.toUtc().add(lifetime));
}

/// Location (device or chosen city) → current weather. Device location is
/// read once per request, never continuously; the permission prompt only
/// appears from a user action. Weather is cached in memory per rounded
/// cell; nothing about location or weather is persisted.
class WeatherController extends Notifier<WeatherState> {
  final _cache = <String, WeatherResponseWeather>{};
  RoundedLocation? _location;
  Future<void>? _running;
  String? _userId;

  /// The system prompt was shown in this app session: automatic paths
  /// (outfit generation) never show it again; "use my location" may.
  bool _prompted = false;

  DeviceLocator get _locator => ref.read(deviceLocatorProvider);
  DateTime _now() => ref.read(weatherClockProvider)();

  @override
  WeatherState build() {
    _userId = ref.watch(authStateProvider.select((s) => s.user?.id));
    _cache.clear();
    _location = null;
    _running = null;
    _prompted = false;
    return const WeatherState();
  }

  /// The location to use for outfits (rounded), if one is known.
  RoundedLocation? get location => _location;

  /// The current weather when it is fresh (for outfit generation).
  WeatherResponseWeather? get freshWeather {
    final w = state.weather;
    return w != null && state.status == WeatherStatus.ready && WeatherFreshness.isFresh(w, _now()) ? w : null;
  }

  bool get isStale {
    final w = state.weather;
    return w != null && !WeatherFreshness.isFresh(w, _now());
  }

  /// Home opened / app resumed: refresh when stale, WITHOUT prompting. Uses
  /// a stored city, or the device when permission was already granted.
  Future<void> refreshIfStale() => _serial(() async {
    if (state.weather != null && !isStale && _location != null) return;
    final location = _location ?? await _silentLocation();
    if (location == null) return;
    await _fetch(location);
  });

  /// A user action that needs location (weather card, outfit generation):
  /// may show the system prompt, at most once per app session. A stored
  /// city is used when there is one.
  Future<void> locate() => _serial(() async {
    final location = _location ?? await _silentLocation(prompt: !_prompted);
    if (location != null) await _fetch(location);
  });

  /// "Use my location" (switches away from a chosen city).
  Future<void> useDeviceLocation() => _serial(() async {
    final userId = _userId;
    if (userId != null) await ref.read(cityStoreProvider).clear(userId);
    if (!ref.mounted) return;
    _location = null;
    state = state.copyWith(city: () => null);
    final location = await _deviceLocation(prompt: true);
    if (location != null) await _fetch(location);
  });

  Future<void> chooseCity(City city) => _serial(() async {
    final userId = _userId;
    if (userId != null) await ref.read(cityStoreProvider).save(userId, city);
    if (!ref.mounted) return;
    _location = city.location;
    state = state.copyWith(source: LocationSource.city, city: () => city, issue: () => null);
    await _fetch(city.location);
  });

  /// Pull-to-refresh: asks the server again (its own 30-minute cache still
  /// applies).
  Future<void> refresh() => _serial(() async {
    final location = _location ?? await _silentLocation();
    if (location != null) await _fetch(location, force: true);
  });

  Future<void> openSettings() =>
      state.issue == LocationIssue.serviceDisabled ? _locator.openLocationSettings() : _locator.openAppSettings();

  Future<void> _serial(Future<void> Function() task) {
    final running = _running;
    if (running != null) return running; // one at a time (double taps)
    final future = task().whenComplete(() => _running = null);
    _running = future;
    return future;
  }

  /// A stored city, else the device when permission is already granted.
  Future<RoundedLocation?> _silentLocation({bool prompt = false}) async {
    final userId = _userId;
    final city = userId == null ? null : await ref.read(cityStoreProvider).read(userId);
    if (!ref.mounted) return null;
    if (city != null) {
      _location = city.location;
      state = state.copyWith(source: LocationSource.city, city: () => city, issue: () => null);
      return _location;
    }
    return _deviceLocation(prompt: prompt);
  }

  Future<RoundedLocation?> _deviceLocation({required bool prompt}) async {
    try {
      if (!await _locator.serviceEnabled()) return _noLocation(LocationIssue.serviceDisabled);
      var access = await _locator.access();
      if (access == LocationAccess.notDetermined || access == LocationAccess.denied) {
        if (!prompt) {
          if (ref.mounted && state.weather == null) state = state.copyWith(status: WeatherStatus.idle);
          return null;
        }
        _prompted = true;
        access = await _locator.requestAccess();
      }
      if (!ref.mounted) return null;
      switch (access) {
        case LocationAccess.deniedForever:
          return _noLocation(LocationIssue.deniedForever);
        case LocationAccess.denied || LocationAccess.notDetermined:
          return _noLocation(LocationIssue.denied);
        case LocationAccess.granted:
          break;
      }
      state = state.copyWith(status: WeatherStatus.locating, source: LocationSource.device);
      final result = await _locator.currentLocation(WeatherFreshness.locationTimeout);
      if (!ref.mounted) return null;
      switch (result) {
        case Located(:final location):
          _location = location;
          state = state.copyWith(issue: () => null);
          return location;
        case NotLocated(:final issue):
          return _noLocation(issue);
      }
    } on Object catch (e) {
      AppLog.warn('location check failed (${e.runtimeType})');
      return _noLocation(LocationIssue.unavailable);
    }
  }

  RoundedLocation? _noLocation(LocationIssue issue) {
    AppLog.info('no device location: ${issue.name}');
    if (ref.mounted) {
      state = state.copyWith(
        status: state.weather == null ? WeatherStatus.noLocation : state.status,
        issue: () => issue,
      );
    }
    return null;
  }

  Future<void> _fetch(RoundedLocation location, {bool force = false}) async {
    final cached = _cache[location.cell];
    if (!force && cached != null && WeatherFreshness.isFresh(cached, _now())) {
      state = state.copyWith(status: WeatherStatus.ready, weather: () => cached, failure: () => null);
      return;
    }
    state = state.copyWith(status: WeatherStatus.loading, failure: () => null);
    try {
      final weather = await ref.read(weatherRepositoryProvider).current(location);
      if (!ref.mounted) return;
      _cache[location.cell] = weather;
      state = state.copyWith(status: WeatherStatus.ready, weather: () => weather, failure: () => null);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('weather not loaded: ${f.describe()}');
      // The last weather (possibly stale) stays visible.
      state = state.copyWith(status: WeatherStatus.failed, failure: () => f);
    }
  }
}
