import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import '../design/typography.dart';

/// The ATLAS mark (an "A" that is also a clothes hanger, in a rounded tile)
/// and wordmark. [onDark] for the
/// brand hero and the splash, which sit on [AtlasColors.heroGradient].
class AtlasLogo extends StatelessWidget {
  const AtlasLogo({super.key, this.size = 40, this.onDark = false, this.showWordmark = true});

  final double size;
  final bool onDark;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: onDark ? AtlasColors.onAccent.withValues(alpha: 0.14) : null,
        gradient: onDark ? null : AtlasColors.heroGradient,
        borderRadius: BorderRadius.circular(size * 0.3),
        border: onDark ? Border.all(color: AtlasColors.onAccent.withValues(alpha: 0.24)) : null,
      ),
      child: const CustomPaint(painter: AtlasMarkPainter()),
    );
    return Semantics(
      label: 'ATLAS',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          mark,
          if (showWordmark) ...[
            SizedBox(width: size * 0.28),
            Text(
              'ATLAS',
              style: AtlasType.title.copyWith(
                fontSize: size * 0.5,
                fontWeight: FontWeight.w800,
                letterSpacing: size * 0.08,
                color: onDark ? AtlasColors.onAccent : AtlasColors.textPrimary,
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

/// The ATLAS mark in white: the same drawing as the app icon
/// (android/app/src/main/res, ios AppIcon, apps/web/public/logo.svg), drawn
/// in a 1024 box and scaled to the canvas.
class AtlasMarkPainter extends CustomPainter {
  const AtlasMarkPainter({this.color = AtlasColors.onAccent});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.shortestSide / 1024 * 0.86;
    canvas
      ..save()
      ..translate(size.width / 2, size.height / 2)
      ..scale(k)
      ..translate(-512, -512);
    Paint stroke(double width) => Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final hook = Path()
      ..moveTo(512, 352)
      ..lineTo(512, 318)
      ..cubicTo(512, 288, 566, 276, 572, 238)
      ..cubicTo(578, 200, 548, 170, 512, 170)
      ..cubicTo(478, 170, 452, 194, 452, 226);
    final hanger = Path()
      ..moveTo(512, 352)
      ..lineTo(254, 694)
      ..cubicTo(246, 706, 254, 720, 268, 720)
      ..lineTo(756, 720)
      ..cubicTo(770, 720, 778, 706, 770, 694)
      ..close();
    canvas
      ..drawPath(hook, stroke(46))
      ..drawPath(hanger, stroke(50))
      ..drawLine(const Offset(358, 574), const Offset(666, 574), stroke(44))
      ..restore();
  }

  @override
  bool shouldRepaint(AtlasMarkPainter oldDelegate) => oldDelegate.color != color;
}
