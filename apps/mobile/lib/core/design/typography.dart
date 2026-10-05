import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

/// Type scale. Uses the platform system font (SF Pro on iOS, Roboto on
/// Android) — crisp, native, nothing to download.
abstract final class AtlasType {
  static const display = TextStyle(
    fontSize: 32,
    height: 1.15,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.6,
    color: AtlasColors.textPrimary,
  );
  static const headline = TextStyle(
    fontSize: 24,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
    color: AtlasColors.textPrimary,
  );
  static const title = TextStyle(
    fontSize: 18,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: AtlasColors.textPrimary,
  );
  static const subtitle = TextStyle(
    fontSize: 16,
    height: 1.35,
    fontWeight: FontWeight.w600,
    color: AtlasColors.textPrimary,
  );
  static const body = TextStyle(
    fontSize: 16,
    height: 1.45,
    fontWeight: FontWeight.w400,
    color: AtlasColors.textPrimary,
  );
  static const bodySecondary = TextStyle(
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w400,
    color: AtlasColors.textSecondary,
  );
  static const label = TextStyle(
    fontSize: 14,
    height: 1.2,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    color: AtlasColors.textPrimary,
  );
  static const caption = TextStyle(
    fontSize: 12,
    height: 1.3,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
    color: AtlasColors.textSecondary,
  );

  /// Small uppercase section label ("BUGUN", "KIYIMLAR").
  static const overline = TextStyle(
    fontSize: 12,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: 1.0,
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
    labelSmall: overline,
  );
}
