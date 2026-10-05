import 'package:atlas_mobile/features/weather/data/device_locator.dart';
import 'package:atlas_mobile/features/weather/data/location.dart';

/// Device location stand-in: permission, service and one result, scripted;
/// every call is counted (a prompt is `requests`).
class FakeLocator implements DeviceLocator {
  bool service = true;
  LocationAccess current = LocationAccess.notDetermined;

  /// What the system prompt answers.
  LocationAccess onRequest = LocationAccess.granted;
  LocationResult result = Located(RoundedLocation.round(41.31, 69.28)!);

  int requests = 0;
  int reads = 0;
  int settingsOpened = 0;

  @override
  Future<bool> serviceEnabled() async => service;

  @override
  Future<LocationAccess> access() async => current;

  @override
  Future<LocationAccess> requestAccess() async {
    requests++;
    return current = onRequest;
  }

  @override
  Future<LocationResult> currentLocation(Duration timeout) async {
    reads++;
    return result;
  }

  @override
  Future<void> openAppSettings() async => settingsOpened++;

  @override
  Future<void> openLocationSettings() async => settingsOpened++;
}
