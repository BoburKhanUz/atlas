import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'core/config/environment_config.dart';
import 'core/logging/app_log.dart';
import 'core/network/providers.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Fails fast on a missing or invalid configuration (see config/README.md).
  final config = AtlasEnvironmentConfig.fromEnvironment();
  AppLog.policy = config.logPolicy;
  AppLog.info('ATLAS starting (${config.environment.name})');
  runApp(ProviderScope(overrides: [environmentConfigProvider.overrideWithValue(config)], child: const AtlasApp()));
}
