import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// Whether the device has any network interface up. This is NOT proof that
/// the API is reachable (captive portals, dead Wi-Fi, server down) — that is
/// learned from actual requests ([ApiReachability]).
abstract interface class DeviceNetwork {
  Future<bool> hasNetwork();
  Stream<bool> get changes;
}

/// connectivity_plus-backed implementation.
class PlatformDeviceNetwork implements DeviceNetwork {
  PlatformDeviceNetwork([Connectivity? connectivity]) : _connectivity = connectivity ?? Connectivity();
  final Connectivity _connectivity;

  static bool _online(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none && r != ConnectivityResult.bluetooth);

  @override
  Future<bool> hasNetwork() async {
    try {
      return _online(await _connectivity.checkConnectivity());
    } on Object {
      // If the platform cannot tell, assume online and let the request decide.
      return true;
    }
  }

  @override
  Stream<bool> get changes => _connectivity.onConnectivityChanged.map(_online).distinct();
}

/// What the app currently knows about reaching ATLAS.
enum NetworkStatus {
  /// Device online, and the last API request reached the server (or none
  /// has failed yet).
  online,

  /// The device has no network.
  noNetwork,

  /// The device is online but the last API request could not reach the
  /// server.
  apiUnreachable,
}

/// Remembers whether the API answered the most recent request. Updated by
/// the HTTP layer; any HTTP response (even an error status) counts as
/// reachable.
class ApiReachability {
  final _controller = StreamController<bool>.broadcast();
  bool _reachable = true;

  bool get reachable => _reachable;
  Stream<bool> get changes => _controller.stream;

  void report({required bool reachable}) {
    if (reachable == _reachable) return;
    _reachable = reachable;
    _controller.add(reachable);
  }

  Future<void> dispose() => _controller.close();
}

/// Combines device connectivity and API reachability.
NetworkStatus combineStatus({required bool deviceOnline, required bool apiReachable}) {
  if (!deviceOnline) return NetworkStatus.noNetwork;
  return apiReachable ? NetworkStatus.online : NetworkStatus.apiUnreachable;
}
