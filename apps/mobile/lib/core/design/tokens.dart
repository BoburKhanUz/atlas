import 'package:material_ui/material_ui.dart';

/// ATLAS colour palette. The six brand values are fixed; the rest are
/// derived tones used for borders, soft fills and status messages.
///
/// Contrast rules (tested in test/core/design/tokens_test.dart):
/// text on [background]/[surface] uses [textPrimary] or [textSecondary];
/// text on [accent] is white; [success] is never a text background
/// (white on it is ~2:1) — use it for icons and indicators only.
abstract final class AtlasColors {
  static const background = Color(0xFFF8F8F6);
  static const surface = Color(0xFFFFFFFF);
  static const textPrimary = Color(0xFF111111);
  static const textSecondary = Color(0xFF6B7280);
  static const accent = Color(0xFF0F766E);
  static const success = Color(0xFF22C55E);

  /// Pressed / hovered accent.
  static const accentStrong = Color(0xFF0B5F58);

  /// Selected-state fills (navigation indicator, chips).
  static const accentSoft = Color(0xFFE3F1EF);

  /// 1 px borders and dividers.
  static const hairline = Color(0xFFE7E5E1);

  /// Skeleton base colour.
  static const skeleton = Color(0xFFECEBE7);

  /// Disabled text and icons (decorative only, not for body text).
  static const textDisabled = Color(0xFFA8A29E);

  static const error = Color(0xFFB42318);
  static const errorSoft = Color(0xFFFDECEA);
  static const warning = Color(0xFF92400E);
  static const warningSoft = Color(0xFFFEF3E2);
  static const successSoft = Color(0xFFE8F8EE);

  /// Text placed on the accent colour.
  static const onAccent = Color(0xFFFFFFFF);

  /// Warm backdrop behind clothing photos and the brand hero.
  static const sand = Color(0xFFF1ECE4);

  /// Deep brand tone for hero cards (white text on it, see tokens_test).
  static const ink = Color(0xFF0B3B37);

  /// Muted text on [ink].
  static const onInkMuted = Color(0xFFB9D6D2);

  /// Hero cards: from [ink] to [accent].
  static const heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [ink, accent],
  );
}

/// Soft shadows for raised surfaces (cards that hold the main action).
abstract final class AtlasShadows {
  static const card = [
    BoxShadow(color: Color(0x0F1C1917), blurRadius: 24, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x0A1C1917), blurRadius: 4, offset: Offset(0, 1)),
  ];
}

/// 4-pt spacing scale.
abstract final class AtlasSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;

  /// Horizontal padding of every screen.
  static const double screen = 20;
}

/// Corner radii: rounded but restrained.
abstract final class AtlasRadii {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double pill = 999;

  static const card = BorderRadius.all(Radius.circular(20));
  static const control = BorderRadius.all(Radius.circular(14));
  static const field = BorderRadius.all(Radius.circular(md));
  static const sheet = BorderRadius.vertical(top: Radius.circular(xl));
}

/// Motion. Durations collapse to zero when the platform asks for reduced
/// motion (see [AtlasMotion.of]).
abstract final class AtlasMotion {
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 250);
  static const slow = Duration(milliseconds: 400);
  static const curve = Curves.easeOutCubic;

  /// Whether animations should run in this context.
  static bool enabled(BuildContext context) => !(MediaQuery.maybeDisableAnimationsOf(context) ?? false);

  /// [duration], or zero when the platform asks for reduced motion.
  static Duration of(BuildContext context, Duration duration) => enabled(context) ? duration : Duration.zero;
}

/// Minimum touch target (Material and Apple HIG guidance).
const double kAtlasMinTouchTarget = 48;
