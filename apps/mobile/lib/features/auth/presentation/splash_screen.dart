import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_brand.dart';

/// Shown while the stored session is restored (bounded: the session
/// controller never waits on the network for long). The same ground and
/// mark as the native launch screen, so the two join without a flash.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: Center(
        child: Semantics(
          label: 'Lookly yuklanmoqda',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const AtlasLogo(size: 112, showWordmark: false),
              const SizedBox(height: AtlasSpacing.md),
              Text(
                AtlasLogo.name,
                style: text.displaySmall?.copyWith(fontSize: 40, letterSpacing: -1.6, color: AtlasColors.ink),
              ),
              const SizedBox(height: AtlasSpacing.xxs),
              Text('Shaxsiy AI stilist', style: text.bodyLarge?.copyWith(color: AtlasColors.textSecondary)),
              const SizedBox(height: AtlasSpacing.xl),
              const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.4)),
            ],
          ),
        ),
      ),
    );
  }
}
