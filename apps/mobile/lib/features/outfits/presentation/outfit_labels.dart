import 'package:built_value/json_object.dart';

/// Uzbek labels for outfit values of the contract (unknown values are shown
/// as they are).
abstract final class OutfitLabels {
  static const _occasions = {
    'work': 'Ish',
    'wedding': 'To‘y',
    'date': 'Uchrashuv',
    'travel': 'Sayohat',
    'casual': 'Kundalik',
    'other': 'Boshqa',
  };

  static const _roles = {'top': 'Ustki qism', 'bottom': 'Pastki qism', 'shoes': 'Poyabzal', 'accessory': 'Aksessuar'};

  /// The backend's canonical weather conditions.
  static const _conditions = {
    'clear': 'Ochiq osmon',
    'partly_cloudy': 'Qisman bulutli',
    'cloudy': 'Bulutli',
    'rain': 'Yomg‘ir',
    'thunderstorm': 'Momaqaldiroq',
    'snow': 'Qor',
    'fog': 'Tuman',
  };

  static String occasion(String v) => _occasions[v] ?? v;
  static String role(String? v) => v == null ? '' : _roles[v] ?? v;
  static String condition(String v) => _conditions[v] ?? v;

  static String temperature(num t) => '${t.round()}°';

  /// "18° · Bulutli" from a stored `weatherSnapshot` (only known keys; `{}`
  /// when the outfit was made without weather → null).
  static String? snapshot(JsonObject snapshot) {
    final map = snapshot.isMap ? snapshot.asMap : const <Object?, Object?>{};
    final t = map['temperature'];
    final c = map['condition'];
    final parts = [if (t is num) temperature(t), if (c is String) condition(c)];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}
