import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show LicenseEntryWithLineBreaks, LicenseRegistry;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'app/build_info.dart';
import 'core/config/environment_config.dart';
import 'core/logging/android_crashes.dart';
import 'core/logging/app_log.dart';
import 'core/logging/crash_reporter.dart';
import 'core/network/providers.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(const ['Manrope'], await rootBundle.loadString('assets/fonts/Manrope-OFL.txt'));
  });
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
  // Crashes outside Dart that ended an earlier run.
  if (Platform.isAndroid) unawaited(crashes.reportAndroidCrashes(const MethodChannelAndroidCrashRecords()));
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
