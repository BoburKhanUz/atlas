import 'package:flutter/foundation.dart';

/// Build-time environment configuration, passed with
/// `--dart-define-from-file=config/<env>.json` (see config/README.md) and
/// validated at startup: an invalid configuration fails fast instead of
/// running against the wrong backend. The app holds no secrets — every
/// credential comes from the user's session.
enum AtlasEnvironment {
  development,
  staging,
  production;

  static AtlasEnvironment parse(String value) => switch (value) {
    'development' => AtlasEnvironment.development,
    'staging' => AtlasEnvironment.staging,
    'production' => AtlasEnvironment.production,
    _ => throw AtlasConfigError('ATLAS_ENV must be development, staging or production (got "$value")'),
  };
}

class AtlasConfigError extends Error {
  AtlasConfigError(this.message);
  final String message;
  @override
  String toString() => 'AtlasConfigError: $message';
}

/// What the logger may emit. Production never logs.
enum LogPolicy {
  /// Requests (method, path, status, timing) and all messages.
  verbose,

  /// Warnings and errors only.
  warnings,

  /// Nothing.
  off,
}

@immutable
class NetworkTimeouts {
  const NetworkTimeouts({
    this.connect = const Duration(seconds: 10),
    this.receive = const Duration(seconds: 20),
    this.send = const Duration(seconds: 60),
    this.refresh = const Duration(seconds: 12),
  });

  final Duration connect;
  final Duration receive;

  /// Upload body transfer (multipart images up to 8 MB on slow networks).
  final Duration send;

  /// Per POST /auth/refresh call (client-recovery-vectors: 12 s).
  final Duration refresh;
}

/// Bounded automatic retries (docs/architecture/mobile-app.md, "Retry").
@immutable
class RetryPolicy {
  const RetryPolicy({
    this.networkRetryDelays = const [Duration(seconds: 1), Duration(seconds: 2)],
    this.networkRetryWindow = const Duration(seconds: 45),
    this.busyMaxRetries = 2,
    this.maxRetryAfter = const Duration(seconds: 30),
    this.maxJitter = const Duration(milliseconds: 250),
  });

  /// Waits before the 1st, 2nd, … retry after a timeout or connection error
  /// (the list length is the retry limit).
  final List<Duration> networkRetryDelays;

  /// No network retry starts later than this after the first attempt.
  final Duration networkRetryWindow;

  /// Retries after 503 SESSION_BUSY (3 attempts in total).
  final int busyMaxRetries;

  /// A Retry-After longer than this is not waited for automatically.
  final Duration maxRetryAfter;

  /// Random extra wait added to Retry-After.
  final Duration maxJitter;
}

@immutable
class AtlasEnvironmentConfig {
  const AtlasEnvironmentConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.debug,
    required this.logPolicy,
    this.timeouts = const NetworkTimeouts(),
    this.retry = const RetryPolicy(),
  });

  /// Validates raw values. Outside development the API must use https.
  factory AtlasEnvironmentConfig.fromValues({
    required String environment,
    required String apiBaseUrl,
    bool releaseBuild = kReleaseMode,
  }) {
    final env = AtlasEnvironment.parse(environment.trim());
    final raw = apiBaseUrl.trim();
    if (raw.isEmpty) throw AtlasConfigError('ATLAS_API_BASE_URL is not set');
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty || !(uri.isScheme('http') || uri.isScheme('https'))) {
      throw AtlasConfigError('ATLAS_API_BASE_URL must be an absolute http(s) URL (got "$raw")');
    }
    if ((uri.path.isNotEmpty && uri.path != '/') || uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) {
      throw AtlasConfigError('ATLAS_API_BASE_URL must be an origin only, e.g. https://api.example.com');
    }
    if (env != AtlasEnvironment.development && !uri.isScheme('https')) {
      throw AtlasConfigError('ATLAS_API_BASE_URL must use https outside development');
    }
    if (env == AtlasEnvironment.production && _isLocalHost(uri.host)) {
      throw AtlasConfigError('ATLAS_API_BASE_URL must not point at a local host in production');
    }
    final debug = env == AtlasEnvironment.development && !releaseBuild;
    return AtlasEnvironmentConfig(
      environment: env,
      apiBaseUrl: Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null),
      debug: debug,
      logPolicy: switch (env) {
        AtlasEnvironment.production => LogPolicy.off,
        _ when releaseBuild => LogPolicy.off,
        AtlasEnvironment.staging => LogPolicy.warnings,
        AtlasEnvironment.development => LogPolicy.verbose,
      },
    );
  }

  /// Reads the compile-time defines.
  factory AtlasEnvironmentConfig.fromEnvironment() => AtlasEnvironmentConfig.fromValues(
    environment: const String.fromEnvironment('ATLAS_ENV', defaultValue: 'development'),
    apiBaseUrl: const String.fromEnvironment('ATLAS_API_BASE_URL'),
  );

  static bool _isLocalHost(String host) =>
      host == 'localhost' ||
      host == '10.0.2.2' ||
      host.startsWith('127.') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.endsWith('.local');

  final AtlasEnvironment environment;

  /// Backend origin without a trailing slash, e.g. `https://api.example.com`.
  final Uri apiBaseUrl;

  /// Developer conveniences (verbose logs, debug UI). Only in development
  /// debug builds.
  final bool debug;

  final LogPolicy logPolicy;
  final NetworkTimeouts timeouts;
  final RetryPolicy retry;

  bool get isProduction => environment == AtlasEnvironment.production;
}
