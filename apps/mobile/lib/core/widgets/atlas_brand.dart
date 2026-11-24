import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import '../design/typography.dart';

/// The Lookly mark and wordmark. The mark images are generated from the
/// brand image by `bun run brand:write` (apps/web/scripts/brand.ts), like the
/// app icons. [onDark] for grounds such as [AtlasColors.heroGradient]: the
/// light mark and a white wordmark.
class AtlasLogo extends StatelessWidget {
  const AtlasLogo({super.key, this.size = 40, this.onDark = false, this.showWordmark = true});

  /// Height of the mark; the wordmark follows it.
  final double size;
  final bool onDark;
  final bool showWordmark;

  static const name = 'Lookly';

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: name,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset(
            onDark ? 'assets/brand/mark_light.png' : 'assets/brand/mark.png',
            width: size,
            height: size,
            filterQuality: FilterQuality.medium,
          ),
          if (showWordmark) ...[
            SizedBox(width: size * 0.22),
            Text(
              name,
              style: AtlasType.title.copyWith(
                fontSize: size * 0.68,
                height: 1,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.04 * size * 0.68,
                color: onDark ? AtlasColors.onAccent : AtlasColors.ink,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Soft circles drawn behind the content of a brand hero.
class HeroDecoration extends StatelessWidget {
  const HeroDecoration({super.key});

  @override
  Widget build(BuildContext context) {
    Widget circle(double size, double alpha) => Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AtlasColors.onAccent.withValues(alpha: alpha),
      ),
    );
    return IgnorePointer(
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(right: -70, top: -50, child: circle(220, 0.06)),
          Positioned(right: 60, bottom: -90, child: circle(170, 0.05)),
          Positioned(left: -40, bottom: 20, child: circle(90, 0.04)),
        ],
      ),
    );
  }
}
