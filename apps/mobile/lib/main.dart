import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'app/build_info.dart';
import 'core/config/environment_config.dart';
import 'core/logging/app_log.dart';
import 'core/logging/crash_reporter.dart';
import 'core/network/providers.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Fails fast on a missing or invalid configuration (see config/README.md).
  final config = AtlasEnvironmentConfig.fromEnvironment();
  AppLog.policy = config.logPolicy;
  // Crash monitoring: errors go to our own server log (docs/ai/monitoring.md).
  final crashes = CrashReporter(
    send: httpErrorReportSender(config),
    appVersion: atlasAppVersion,
    platform: devicePlatform(),
    osVersion: deviceOsVersion(),
  )..install();
  AppLog.info('ATLAS starting (${config.environment.name})');
  runApp(
    ProviderScope(
      overrides: [
        environmentConfigProvider.overrideWithValue(config),
        crashReporterProvider.overrideWithValue(crashes),
      ],
      child: const AtlasApp(),
    ),
  );
}
