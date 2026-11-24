import 'package:material_ui/material_ui.dart';

/// Lookly colour palette (brand specification, November 2026). This file is
/// the one source of the brand colours: `bun run brand:write` (apps/web)
/// carries them to the web palette, the icons and Android's resources.
///
/// Contrast rules (tested in test/core/design/tokens_test.dart):
/// text on [background]/[surface] uses [textPrimary] or [textSecondary];
/// text on [accent], [ink] and [success] is white.
abstract final class AtlasColors {
  static const background = Color(0xFFFAF9FF);
  static const surface = Color(0xFFFFFFFF);
  static const textPrimary = Color(0xFF17112B);
  static const textSecondary = Color(0xFF5D586B);
  static const accent = Color(0xFF5B21B6);
  static const success = Color(0xFF166534);

  /// Pressed / hovered accent; the dark end of the app icon.
  static const accentStrong = Color(0xFF4C1D95);

  /// The bright end of the app icon gradient (not for text backgrounds
  /// under small text).
  static const accentBright = Color(0xFF7C3AED);

  /// Selected-state fills (navigation indicator, chips).
  static const accentSoft = Color(0xFFEEE7FF);

  /// 1 px borders and dividers.
  static const hairline = Color(0xFFE5E0EF);

  /// Skeleton base colour.
  static const skeleton = Color(0xFFECE9F3);

  /// Disabled text and icons (decorative only, not for body text).
  static const textDisabled = Color(0xFFA7A2B5);

  static const error = Color(0xFFB42318);
  static const errorSoft = Color(0xFFFDECEA);
  static const warning = Color(0xFF92400E);
  static const warningSoft = Color(0xFFFEF3E2);
  static const successSoft = Color(0xFFE8F8EE);

  /// Text placed on the accent colour.
  static const onAccent = Color(0xFFFFFFFF);

  /// Warm backdrop behind clothing photos.
  static const sand = Color(0xFFF3EBDD);

  /// Deep brand tone for hero cards (white text on it, see tokens_test).
  static const ink = Color(0xFF1F1147);

  /// Muted text on [ink].
  static const onInkMuted = Color(0xFFD8CFF0);

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
    BoxShadow(color: Color(0x141F1147), blurRadius: 24, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x0A1F1147), blurRadius: 4, offset: Offset(0, 1)),
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
