import 'package:flutter/foundation.dart';

/// A location as the app may use it: rounded to 2 decimal places (~1 km,
/// the same cell the server caches weather by) and validated. A raw device
/// coordinate never leaves the platform adapter; this is the only form the
/// rest of the app sees, sends or keeps (in memory only).
@immutable
class RoundedLocation {
  const RoundedLocation._(this.lat, this.lon);

  final double lat;
  final double lon;

  /// Rounds first, then validates the rounded values. Null when they are not
  /// a valid latitude/longitude (NaN, infinite, out of range).
  static RoundedLocation? round(double lat, double lon) {
    final rLat = roundCoordinate(lat);
    final rLon = roundCoordinate(lon);
    if (!_valid(rLat, -90, 90) || !_valid(rLon, -180, 180)) return null;
    return RoundedLocation._(rLat, rLon);
  }

  static double roundCoordinate(double value) => value.isFinite ? (value * 100).roundToDouble() / 100 : double.nan;

  static bool _valid(double v, double min, double max) => v.isFinite && v >= min && v <= max;

  /// In-memory cache key (the server's cell).
  String get cell => '${lat.toStringAsFixed(2)},${lon.toStringAsFixed(2)}';

  @override
  bool operator ==(Object other) => other is RoundedLocation && other.lat == lat && other.lon == lon;
  @override
  int get hashCode => Object.hash(lat, lon);

  /// Never prints coordinates (logs, errors, debug output).
  @override
  String toString() => 'RoundedLocation(…)';
}
