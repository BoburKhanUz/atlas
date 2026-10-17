import 'dart:async';
import 'dart:io' show Platform;

import 'package:atlas_api/atlas_api.dart'
    show AtlasApi, ClientErrorReport, ClientErrorReportKindEnum, ClientErrorReportPlatformEnum, ClientErrorsRequest;
import 'package:built_collection/built_collection.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/environment_config.dart';
import 'app_log.dart';

/// The scrubbing rules of the server (apps/web/src/lib/error-scrub.ts): an
/// error text may quote a request, so e-mail addresses, Bearer values, JWTs,
/// URL query strings (signatures, one-time tokens) and long opaque values
/// (refresh tokens, keys) are dropped before a report leaves the phone.
abstract final class ErrorScrub {
  static final _email = RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
  static final _bearer = RegExp(r'Bearer\s+[A-Za-z0-9._~+/=-]+', caseSensitive: false);
  static final _jwt = RegExp(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}');
  static final _urlQuery = RegExp(r'''(https?://[^\s?#"'<>]+)\?[^\s#"'<>]*''');
  // '/' is not part of it: paths in stack frames stay readable
  static final _opaque = RegExp(r'[A-Za-z0-9_+=-]{32,}');
  static final _idSegment = RegExp(r'^[A-Za-z0-9_-]{16,}$');

  static String text(String s) => s
      .replaceAll(_bearer, 'Bearer [REDACTED]')
      .replaceAll(_jwt, '[REDACTED_JWT]')
      .replaceAll(_email, '[REDACTED_EMAIL]')
      .replaceAllMapped(_urlQuery, (m) => '${m[1]}?[REDACTED]')
      .replaceAll(_opaque, '[REDACTED]');

  /// /wardrobe/item/cmxyz…?a=b → /wardrobe/item/:id
  static String route(String path) =>
      path.split(RegExp('[?#]')).first.split('/').map((s) => _idSegment.hasMatch(s) ? ':id' : s).join('/');
}

typedef ErrorReportSender = Future<void> Function(List<ClientErrorReport> reports);

/// Crash monitoring on our own server (POST /api/v1/client-errors, written to
/// its log, never stored): Flutter framework errors and uncaught async errors.
/// Each distinct error once, at most [maxPerRun] per app run, sent in batches
/// of [maxBatch] shortly after the first one. No user id; every text goes
/// through [ErrorScrub]. A failing send is dropped and never reported itself.
class CrashReporter {
  CrashReporter({
    required ErrorReportSender send,
    required String appVersion,
    required ClientErrorReportPlatformEnum platform,
    String? osVersion,
    this.flushDelay = const Duration(seconds: 2),
    DateTime Function()? clock,
  }) : _send = send, // ignore: prefer_initializing_formals
       _appVersion = _cap(appVersion, 40),
       _platform = platform, // ignore: prefer_initializing_formals
       _osVersion = osVersion == null ? null : _cap(osVersion, 120),
       _clock = clock ?? DateTime.now;

  static const maxPerRun = 20;
  static const maxBatch = 10;

  final ErrorReportSender _send;
  final String _appVersion;
  final ClientErrorReportPlatformEnum _platform;
  final String? _osVersion;
  final DateTime Function() _clock;
  final Duration flushDelay;

  /// The screen the user is on (set once the router exists).
  String Function()? currentRoute;

  final _seen = <String>{};
  final _queue = <ClientErrorReport>[];
  var _accepted = 0;
  Timer? _timer;
  var _sending = false;

  static String _cap(String s, int max) => s.length <= max ? s : s.substring(0, max);

  /// Queues one error. Never throws.
  void record(Object error, StackTrace? stack, {required ClientErrorReportKindEnum kind, bool fatal = false}) {
    try {
      final message = ErrorScrub.text(error.toString());
      final frames = stack?.toString().trim() ?? '';
      final firstFrame = frames.split('\n').first;
      if (_accepted >= maxPerRun || !_seen.add('${kind.name}|${error.runtimeType}|$message|$firstFrame')) return;
      _accepted++;
      final route = currentRoute?.call();
      _queue.add(
        ClientErrorReport(
          (b) => b
            ..platform = _platform
            ..appVersion = _appVersion
            ..osVersion = _osVersion
            ..kind = kind
            ..fatal = fatal
            ..errorType = _cap(error.runtimeType.toString(), 200)
            ..message = _cap(message, 1000)
            ..stack = frames.isEmpty ? null : _cap(ErrorScrub.text(frames), 4000)
            ..route = route == null ? null : _cap(ErrorScrub.route(route), 200)
            ..occurredAt = _clock().toUtc(),
        ),
      );
      _timer ??= Timer(flushDelay, () => unawaited(flush()));
    } on Object {
      // Reporting must never throw.
    }
  }

  /// Sends what is queued. Never throws.
  Future<void> flush() async {
    _timer?.cancel();
    _timer = null;
    if (_sending) return;
    _sending = true;
    try {
      while (_queue.isNotEmpty) {
        final batch = _queue.take(maxBatch).toList();
        _queue.removeRange(0, batch.length);
        try {
          await _send(batch);
        } on Object {
          // Dropped: a report about the reporter would only loop.
        }
      }
    } finally {
      _sending = false;
    }
  }

  /// Hooks framework errors (keeping their usual presentation) and uncaught
  /// async errors.
  void install() {
    final present = FlutterError.onError;
    FlutterError.onError = (details) {
      present?.call(details);
      record(details.exception, details.stack, kind: ClientErrorReportKindEnum.flutter);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      AppLog.error('uncaught error', error);
      record(error, stack, kind: ClientErrorReportKindEnum.dart, fatal: true);
      return true;
    };
  }
}

/// The phone's platform for reports.
ClientErrorReportPlatformEnum devicePlatform() =>
    Platform.isIOS ? ClientErrorReportPlatformEnum.ios : ClientErrorReportPlatformEnum.android;

String deviceOsVersion() => '${Platform.operatingSystem} ${Platform.operatingSystemVersion}';

/// Sends reports with a Dio of its own (no session, retry or logging
/// interceptors), so its failures can never produce another report.
ErrorReportSender httpErrorReportSender(AtlasEnvironmentConfig config, {HttpClientAdapter? adapter}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: config.apiBaseUrl.toString(),
      connectTimeout: config.timeouts.connect,
      receiveTimeout: config.timeouts.receive,
      sendTimeout: config.timeouts.receive,
      headers: {'X-Atlas-Client': 'mobile'},
      followRedirects: false,
      validateStatus: (status) => status != null && status >= 200 && status < 300,
    ),
  );
  if (adapter != null) dio.httpClientAdapter = adapter;
  final api = AtlasApi(dio: dio, interceptors: const []);
  return (reports) => api.getServiceApi().reportClientErrors(
    clientErrorsRequest: ClientErrorsRequest((b) => b..reports = ListBuilder<ClientErrorReport>(reports)),
  );
}

/// The app's reporter (overridden in main.dart; none in tests).
final crashReporterProvider = Provider<CrashReporter?>((ref) => null);
