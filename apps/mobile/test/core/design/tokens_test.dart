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
  group('brand palette is exactly the ATLAS values', () {
    test('six fixed colours', () {
      expect(AtlasColors.background, const Color(0xFFF8F8F6));
      expect(AtlasColors.surface, const Color(0xFFFFFFFF));
      expect(AtlasColors.textPrimary, const Color(0xFF111111));
      expect(AtlasColors.textSecondary, const Color(0xFF6B7280));
      expect(AtlasColors.accent, const Color(0xFF0F766E));
      expect(AtlasColors.success, const Color(0xFF22C55E));
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
    };
    cases.forEach((name, c) {
      test('$name ≥ ${c.$3}:1', () {
        final ratio = contrast(c.$1, c.$2);
        expect(ratio, greaterThanOrEqualTo(c.$3), reason: '$name is ${ratio.toStringAsFixed(2)}:1');
      });
    });

    test('success green is too light for white text, so it is never used as a text background', () {
      expect(contrast(AtlasColors.onAccent, AtlasColors.success), lessThan(3));
      // The theme pairs it with dark text where it appears as a container colour.
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
