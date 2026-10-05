import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'core/config/app_config.dart';
import 'core/logging/app_log.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  AppLog.info('ATLAS starting (${config.environment.name})');
  runApp(ProviderScope(overrides: [appConfigProvider.overrideWithValue(config)], child: const AtlasApp()));
}
