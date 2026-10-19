import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_brand.dart';

/// Shown while the stored session is restored (bounded: the session
/// controller never waits on the network for long).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: DecoratedBox(
          decoration: const BoxDecoration(gradient: AtlasColors.heroGradient),
          child: Stack(
            children: [
              const Positioned.fill(child: HeroDecoration()),
              Center(
                child: Semantics(
                  label: 'ATLAS yuklanmoqda',
                  child: const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AtlasLogo(size: 56, onDark: true),
                      SizedBox(height: AtlasSpacing.xl),
                      SizedBox.square(
                        dimension: 24,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: AtlasColors.onAccent),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
