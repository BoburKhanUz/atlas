import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'tokens.dart';
import 'typography.dart';

/// The single ATLAS theme (light). Component themes are set here so screens
/// use plain Material widgets and still look like ATLAS.
abstract final class AtlasTheme {
  static const colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AtlasColors.accent,
    onPrimary: AtlasColors.onAccent,
    primaryContainer: AtlasColors.accentSoft,
    onPrimaryContainer: AtlasColors.accentStrong,
    secondary: AtlasColors.textPrimary,
    onSecondary: AtlasColors.surface,
    tertiary: AtlasColors.success,
    onTertiary: AtlasColors.textPrimary,
    error: AtlasColors.error,
    onError: AtlasColors.surface,
    errorContainer: AtlasColors.errorSoft,
    onErrorContainer: AtlasColors.error,
    surface: AtlasColors.surface,
    onSurface: AtlasColors.textPrimary,
    onSurfaceVariant: AtlasColors.textSecondary,
    surfaceContainerLowest: AtlasColors.surface,
    surfaceContainerLow: AtlasColors.background,
    surfaceContainer: AtlasColors.background,
    surfaceContainerHigh: AtlasColors.skeleton,
    outline: AtlasColors.hairline,
    outlineVariant: AtlasColors.hairline,
    shadow: Color(0x14000000),
    scrim: Color(0x66000000),
    surfaceTint: Colors.transparent,
  );

  static ThemeData light() {
    final text = AtlasType.textTheme();
    const controlSize = Size.fromHeight(52);
    const controlShape = RoundedRectangleBorder(borderRadius: AtlasRadii.control);

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AtlasColors.background,
      canvasColor: AtlasColors.background,
      textTheme: text,
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      dividerTheme: const DividerThemeData(color: AtlasColors.hairline, thickness: 1, space: 1),
      appBarTheme: const AppBarTheme(
        backgroundColor: AtlasColors.background,
        foregroundColor: AtlasColors.textPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: AtlasType.title,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
        ),
      ),
      cardTheme: const CardThemeData(
        color: AtlasColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: AtlasRadii.card,
          side: BorderSide(color: AtlasColors.hairline),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AtlasColors.accent,
          foregroundColor: AtlasColors.onAccent,
          disabledBackgroundColor: AtlasColors.hairline,
          disabledForegroundColor: AtlasColors.textSecondary,
          minimumSize: controlSize,
          shape: controlShape,
          textStyle: AtlasType.label.copyWith(fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AtlasColors.textPrimary,
          minimumSize: controlSize,
          shape: controlShape,
          side: const BorderSide(color: AtlasColors.hairline),
          textStyle: AtlasType.label.copyWith(fontSize: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AtlasColors.accent,
          minimumSize: const Size(kAtlasMinTouchTarget, kAtlasMinTouchTarget),
          textStyle: AtlasType.label,
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: AtlasColors.surface,
        contentPadding: EdgeInsets.symmetric(horizontal: AtlasSpacing.md, vertical: AtlasSpacing.md),
        hintStyle: TextStyle(color: AtlasColors.textSecondary),
        labelStyle: TextStyle(color: AtlasColors.textSecondary),
        border: OutlineInputBorder(
          borderRadius: AtlasRadii.field,
          borderSide: BorderSide(color: AtlasColors.hairline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AtlasRadii.field,
          borderSide: BorderSide(color: AtlasColors.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AtlasRadii.field,
          borderSide: BorderSide(color: AtlasColors.accent, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AtlasRadii.field,
          borderSide: BorderSide(color: AtlasColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AtlasRadii.field,
          borderSide: BorderSide(color: AtlasColors.error, width: 1.5),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AtlasColors.surface,
        selectedColor: AtlasColors.accentSoft,
        side: const BorderSide(color: AtlasColors.hairline),
        shape: const StadiumBorder(),
        labelStyle: AtlasType.label.copyWith(fontWeight: FontWeight.w500),
        padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.xs, vertical: AtlasSpacing.xxs),
        showCheckmark: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AtlasColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 68,
        indicatorColor: AtlasColors.accentSoft,
        indicatorShape: const StadiumBorder(),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 24,
            color: states.contains(WidgetState.selected) ? AtlasColors.accent : AtlasColors.textSecondary,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => AtlasType.caption.copyWith(
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
            color: states.contains(WidgetState.selected) ? AtlasColors.textPrimary : AtlasColors.textSecondary,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AtlasColors.textPrimary,
        contentTextStyle: AtlasType.body.copyWith(color: AtlasColors.surface, fontSize: 15),
        shape: const RoundedRectangleBorder(borderRadius: AtlasRadii.field),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AtlasColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: AtlasRadii.sheet),
        showDragHandle: true,
      ),
      dialogTheme: const DialogThemeData(
        backgroundColor: AtlasColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: AtlasRadii.card),
        titleTextStyle: AtlasType.title,
        contentTextStyle: AtlasType.bodySecondary,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AtlasColors.accent,
        linearTrackColor: AtlasColors.hairline,
        circularTrackColor: Colors.transparent,
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: AtlasColors.textSecondary,
        textColor: AtlasColors.textPrimary,
        contentPadding: EdgeInsets.symmetric(horizontal: AtlasSpacing.md),
        minVerticalPadding: AtlasSpacing.sm,
      ),
      // Page transitions: platform defaults (Cupertino on iOS, Material on
      // Android) are the native behaviour we want.
    );
  }
}
