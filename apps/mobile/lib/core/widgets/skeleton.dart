import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';

/// Placeholder block shown while content loads. Pulses gently; static when
/// the platform asks for reduced motion. Hidden from screen readers (the
/// surrounding [LoadingView] announces "loading" once).
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 16, this.radius = AtlasRadii.sm});

  final double? width;
  final double height;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (AtlasMotion.enabled(context)) {
      if (!_controller.isAnimating) _controller.repeat(reverse: true);
    } else {
      _controller
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: FadeTransition(
        opacity: Tween<double>(
          begin: 1,
          end: 0.55,
        ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut)),
        child: Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(color: AtlasColors.skeleton, borderRadius: BorderRadius.circular(widget.radius)),
        ),
      ),
    );
  }
}

/// A list of card-shaped skeletons with a single "loading" announcement.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.items = 3, this.semanticLabel = 'Yuklanmoqda'});

  final int items;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      liveRegion: true,
      child: ListView.separated(
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        physics: const NeverScrollableScrollPhysics(),
        itemCount: items,
        separatorBuilder: (_, _) => const SizedBox(height: AtlasSpacing.md),
        itemBuilder: (_, _) => const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Skeleton(height: 160, radius: AtlasRadii.lg),
            SizedBox(height: AtlasSpacing.sm),
            Skeleton(width: 180),
            SizedBox(height: AtlasSpacing.xs),
            Skeleton(width: 120, height: 12),
          ],
        ),
      ),
    );
  }
}
