import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

/// Type scale in the brand typeface, Manrope (bundled: assets/fonts, SIL
/// Open Font License). Every style names the family, so text that does not
/// inherit from the theme (button labels, chips) uses it too.
abstract final class AtlasType {
  static const family = 'Manrope';

  static const display = TextStyle(
    fontFamily: family,
    fontSize: 30,
    height: 1.15,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.8,
    color: AtlasColors.textPrimary,
  );
  static const headline = TextStyle(
    fontFamily: family,
    fontSize: 24,
    height: 1.2,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.5,
    color: AtlasColors.textPrimary,
  );
  static const title = TextStyle(
    fontFamily: family,
    fontSize: 18,
    height: 1.3,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
    color: AtlasColors.textPrimary,
  );
  static const subtitle = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 1.35,
    fontWeight: FontWeight.w700,
    color: AtlasColors.textPrimary,
  );
  static const body = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 1.5,
    fontWeight: FontWeight.w500,
    color: AtlasColors.textPrimary,
  );
  static const bodySecondary = TextStyle(
    fontFamily: family,
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w500,
    color: AtlasColors.textSecondary,
  );
  static const label = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.1,
    color: AtlasColors.textPrimary,
  );
  static const caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    color: AtlasColors.textSecondary,
  );

  /// Small text that must stay readable: timestamps, counters, tags.
  static const small = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.3,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.1,
    color: AtlasColors.textSecondary,
  );

  /// Small uppercase section label ("BUGUN", "KIYIMLAR"); used directly,
  /// never for sentences.
  static const overline = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.2,
    fontWeight: FontWeight.w800,
    letterSpacing: 1.2,
    color: AtlasColors.textSecondary,
  );

  static TextTheme textTheme() => const TextTheme(
    displaySmall: display,
    headlineMedium: headline,
    headlineSmall: headline,
    titleLarge: title,
    titleMedium: subtitle,
    titleSmall: label,
    bodyLarge: body,
    bodyMedium: bodySecondary,
    bodySmall: caption,
    labelLarge: label,
    labelMedium: caption,
    labelSmall: small,
  );
}
