import 'dart:io';
import 'dart:math' as math;

import 'package:atlas_mobile/core/design/theme.dart';
import 'package:atlas_mobile/core/design/tokens.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// WCAG 2.x relative luminance and contrast ratio.
double _luminance(Color c) {
  double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  group('brand palette is exactly the Lookly specification', () {
    test('fixed colours', () {
      expect(AtlasColors.background, const Color(0xFFFAF9FF));
      expect(AtlasColors.surface, const Color(0xFFFFFFFF));
      expect(AtlasColors.textPrimary, const Color(0xFF17112B));
      expect(AtlasColors.textSecondary, const Color(0xFF5D586B));
      expect(AtlasColors.accent, const Color(0xFF5B21B6));
      expect(AtlasColors.accentStrong, const Color(0xFF4C1D95));
      expect(AtlasColors.ink, const Color(0xFF1F1147));
      expect(AtlasColors.success, const Color(0xFF166534));
    });
  });

  group('contrast (WCAG AA 4.5:1 for text, AAA 7:1 for primary text)', () {
    final cases = <String, (Color, Color, double)>{
      'primary text on background': (AtlasColors.textPrimary, AtlasColors.background, 7),
      'primary text on surface': (AtlasColors.textPrimary, AtlasColors.surface, 7),
      'secondary text on surface': (AtlasColors.textSecondary, AtlasColors.surface, 4.5),
      'secondary text on background': (AtlasColors.textSecondary, AtlasColors.background, 4.5),
      'white on accent (filled buttons)': (AtlasColors.onAccent, AtlasColors.accent, 4.5),
      'accent text on surface (text buttons, links)': (AtlasColors.accent, AtlasColors.surface, 4.5),
      'accent text on background': (AtlasColors.accent, AtlasColors.background, 4.5),
      'accent-strong on accent-soft (selected chips)': (AtlasColors.accentStrong, AtlasColors.accentSoft, 4.5),
      'primary text on accent-soft (selected nav label)': (AtlasColors.textPrimary, AtlasColors.accentSoft, 7),
      'error on error-soft': (AtlasColors.error, AtlasColors.errorSoft, 4.5),
      'error on surface': (AtlasColors.error, AtlasColors.surface, 4.5),
      'warning on warning-soft': (AtlasColors.warning, AtlasColors.warningSoft, 4.5),
      'surface on primary text (snackbar)': (AtlasColors.surface, AtlasColors.textPrimary, 7),
      'white on ink (hero cards)': (AtlasColors.onAccent, AtlasColors.ink, 7),
      'muted text on ink (hero cards)': (AtlasColors.onInkMuted, AtlasColors.ink, 4.5),
      'primary text on sand (photo backdrop)': (AtlasColors.textPrimary, AtlasColors.sand, 7),
      'white on the light end of the hero gradient': (AtlasColors.onAccent, AtlasColors.accent, 4.5),
    };
    cases.forEach((name, c) {
      test('$name ≥ ${c.$3}:1', () {
        final ratio = contrast(c.$1, c.$2);
        expect(ratio, greaterThanOrEqualTo(c.$3), reason: '$name is ${ratio.toStringAsFixed(2)}:1');
      });
    });

    test('white text on success (the theme pairs them where success is a container colour)', () {
      expect(contrast(AtlasColors.onAccent, AtlasColors.success), greaterThanOrEqualTo(4.5));
      expect(contrast(AtlasTheme.colorScheme.onTertiary, AtlasTheme.colorScheme.tertiary), greaterThanOrEqualTo(4.5));
    });
  });

  test('every scheme on/background pair used by Material components meets 4.5:1', () {
    const s = AtlasTheme.colorScheme;
    for (final (fg, bg, name) in [
      (s.onPrimary, s.primary, 'onPrimary/primary'),
      (s.onPrimaryContainer, s.primaryContainer, 'onPrimaryContainer'),
      (s.onSecondary, s.secondary, 'onSecondary'),
      (s.onTertiary, s.tertiary, 'onTertiary'),
      (s.onError, s.error, 'onError'),
      (s.onErrorContainer, s.errorContainer, 'onErrorContainer'),
      (s.onSurface, s.surface, 'onSurface'),
      (s.onSurfaceVariant, s.surface, 'onSurfaceVariant'),
    ]) {
      expect(contrast(fg, bg), greaterThanOrEqualTo(4.5), reason: name);
    }
  });

  test('theme uses the tokens', () {
    final t = AtlasTheme.light();
    expect(t.useMaterial3, isTrue);
    expect(t.scaffoldBackgroundColor, AtlasColors.background);
    expect(t.colorScheme.primary, AtlasColors.accent);
    expect(t.navigationBarTheme.indicatorColor, AtlasColors.accentSoft);
    expect(t.textTheme.displaySmall!.color, AtlasColors.textPrimary);
  });

  test('Android launcher and launch-screen colours are the brand tokens (bun run brand:write)', () {
    // values/colors.xml is generated from tokens.dart by apps/web/scripts/brand.ts.
    final xml = File('android/app/src/main/res/values/colors.xml').readAsStringSync();
    String hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';
    expect(xml, contains('<color name="brand_background">${hex(AtlasColors.background)}</color>'));
    expect(xml, contains('<color name="brand_icon_start">${hex(AtlasColors.accentStrong)}</color>'));
    expect(xml, contains('<color name="brand_icon_end">${hex(AtlasColors.accentBright)}</color>'));
    final background = File('android/app/src/main/res/drawable/ic_launcher_background.xml').readAsStringSync();
    expect(background, isNot(contains('#')), reason: 'colours come from values/colors.xml');
  });

  test('spacing is a 4-pt scale and touch targets are at least 48', () {
    for (final v in [
      AtlasSpacing.xxs,
      AtlasSpacing.xs,
      AtlasSpacing.sm,
      AtlasSpacing.md,
      AtlasSpacing.lg,
      AtlasSpacing.xl,
      AtlasSpacing.xxl,
      AtlasSpacing.screen,
    ]) {
      expect(v % 4, 0, reason: '$v');
    }
    expect(kAtlasMinTouchTarget, greaterThanOrEqualTo(48));
  });
}
