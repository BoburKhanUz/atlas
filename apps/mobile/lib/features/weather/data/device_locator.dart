import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../../../core/logging/app_log.dart';
import 'location.dart';

/// The location permission as the app distinguishes it.
enum LocationAccess { notDetermined, denied, deniedForever, granted }

/// Why no device location could be used.
enum LocationIssue { denied, deniedForever, serviceDisabled, timeout, unavailable }

/// The outcome of one device-location attempt.
sealed class LocationResult {
  const LocationResult();
}

final class Located extends LocationResult {
  const Located(this.location);
  final RoundedLocation location;
}

final class NotLocated extends LocationResult {
  const NotLocated(this.issue);
  final LocationIssue issue;
}

/// Device location, behind an interface (tests use a fake).
abstract interface class DeviceLocator {
  Future<bool> serviceEnabled();
  Future<LocationAccess> access();

  /// Shows the system "while in use" prompt (only from a user action).
  Future<LocationAccess> requestAccess();

  /// ONE low-accuracy position read, bounded by [timeout]. The raw position
  /// is rounded and validated here and never leaves this method.
  Future<LocationResult> currentLocation(Duration timeout);

  Future<void> openAppSettings();
  Future<void> openLocationSettings();
}

/// geolocator: coarse ("low") accuracy, while in use, a single read — no
/// position stream, no background updates.
class PlatformDeviceLocator implements DeviceLocator {
  @override
  Future<bool> serviceEnabled() => Geolocator.isLocationServiceEnabled();

  @override
  Future<LocationAccess> access() async => _map(await Geolocator.checkPermission());

  @override
  Future<LocationAccess> requestAccess() async => _map(await Geolocator.requestPermission());

  static LocationAccess _map(LocationPermission p) => switch (p) {
    LocationPermission.whileInUse || LocationPermission.always => LocationAccess.granted,
    LocationPermission.deniedForever => LocationAccess.deniedForever,
    LocationPermission.denied => LocationAccess.notDetermined,
    LocationPermission.unableToDetermine => LocationAccess.notDetermined,
  };

  @override
  Future<LocationResult> currentLocation(Duration timeout) async {
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.low, timeLimit: timeout),
      ).timeout(timeout + const Duration(seconds: 2));
      final rounded = RoundedLocation.round(p.latitude, p.longitude);
      return rounded == null ? const NotLocated(LocationIssue.unavailable) : Located(rounded);
    } on TimeoutException {
      return const NotLocated(LocationIssue.timeout);
    } on LocationServiceDisabledException {
      return const NotLocated(LocationIssue.serviceDisabled);
    } on PermissionDeniedException {
      return const NotLocated(LocationIssue.denied);
    } on Object catch (e) {
      // The type only: platform messages may carry details.
      AppLog.warn('device location unavailable (${e.runtimeType})');
      return const NotLocated(LocationIssue.unavailable);
    }
  }

  @override
  Future<void> openAppSettings() => Geolocator.openAppSettings();

  @override
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}
