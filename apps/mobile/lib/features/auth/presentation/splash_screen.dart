import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';

/// Shown while the stored session is restored (bounded: the session
/// controller never waits on the network for long).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Semantics(
          label: 'ATLAS yuklanmoqda',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('ATLAS', style: Theme.of(context).textTheme.displaySmall?.copyWith(letterSpacing: 4)),
              const SizedBox(height: AtlasSpacing.lg),
              const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.4)),
            ],
          ),
        ),
      ),
    );
  }
}
