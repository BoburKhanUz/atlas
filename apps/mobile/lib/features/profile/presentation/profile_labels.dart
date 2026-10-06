import '../../onboarding/data/options.dart';

/// Uzbek labels for colour-analysis values (unknown values shown as is).
abstract final class ProfileLabels {
  static String season(String? v) =>
      const {'spring': 'Bahor', 'summer': 'Yoz', 'autumn': 'Kuz', 'winter': 'Qish'}[v] ?? v ?? 'aniqlanmadi';
  static String undertone(String? v) =>
      const {
        'warm': 'Iliq',
        'neutral_warm': 'Neytral-iliq',
        'neutral': 'Neytral',
        'neutral_cool': 'Neytral-sovuq',
        'cool': 'Sovuq',
        'unknown': 'aniqlanmadi',
      }[v] ??
      v ??
      '—';
  static String contrast(String? v) => const {'low': 'Past', 'medium': 'O‘rta', 'high': 'Yuqori'}[v] ?? v ?? '—';
  static String skinTone(String? v) =>
      const {'light': 'Och', 'medium': 'O‘rta', 'tan': 'Qoramtir', 'deep': 'To‘q'}[v] ?? v ?? '—';

  /// Hair/eye colours and palettes are catalogue colour ids.
  static String color(String? v) =>
      v == null ? '—' : ColorOption.values.where((o) => o.wire == v).firstOrNull?.label ?? v;
  static ColorOption? option(String v) => ColorOption.values.where((o) => o.wire == v).firstOrNull;
}
