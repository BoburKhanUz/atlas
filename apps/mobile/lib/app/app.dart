import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../core/config/app_config.dart';
import '../core/design/theme.dart';
import 'router.dart';

/// Provided by main.dart (and by tests) via ProviderScope overrides.
final appConfigProvider = Provider<AppConfig>(
  (ref) => throw UnimplementedError('appConfigProvider must be overridden'),
);

class AtlasApp extends ConsumerWidget {
  const AtlasApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'ATLAS',
      debugShowCheckedModeBanner: false,
      theme: AtlasTheme.light(),
      themeMode: ThemeMode.light,
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) {
        // Respect the user's text size, but cap it so layouts stay usable.
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(textScaler: media.textScaler.clamp(maxScaleFactor: 1.6)),
          child: child!,
        );
      },
    );
  }
}
