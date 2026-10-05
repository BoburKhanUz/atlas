import 'package:flutter/foundation.dart';

import '../config/environment_config.dart';

/// Minimal logger. Every message goes through [redact] first. What is
/// emitted is decided by the environment's [LogPolicy] (production and every
/// release build: nothing). Never log headers or request/response bodies;
/// keep logs to methods, paths, status codes, error codes and timings.
abstract final class AppLog {
  /// Set once at startup from the environment configuration.
  static LogPolicy policy = kReleaseMode ? LogPolicy.off : LogPolicy.verbose;

  /// Replaced in tests to capture output.
  @visibleForTesting
  static void Function(String line) sink = _debugSink;

  static void debug(String message) => _emit(_Level.debug, message);
  static void info(String message) => _emit(_Level.info, message);
  static void warn(String message) => _emit(_Level.warn, message);
  static void error(String message, [Object? error]) =>
      _emit(_Level.error, error == null ? message : '$message: ${error.runtimeType}');

  static bool _allowed(_Level level) => switch (policy) {
    LogPolicy.verbose => true,
    LogPolicy.warnings => level == _Level.warn || level == _Level.error,
    LogPolicy.off => false,
  };

  static void _emit(_Level level, String message) {
    if (!_allowed(level)) return;
    sink('[atlas][${level.tag}] ${redact(message)}');
  }

  static void _debugSink(String line) => debugPrint(line);

  static final _patterns = <(RegExp, String)>[
    // Authorization: Bearer <token>
    (RegExp(r'(Bearer\s+)[A-Za-z0-9\-_.~+/=]+', caseSensitive: false), r'$1[REDACTED]'),
    // JSON / map fields carrying tokens or secrets
    (
      RegExp(
        r'''(["']?(?:access_?token|refresh_?token|accessToken|refreshToken|password|token|secret|idempotency-?key)["']?\s*[:=]\s*["']?)[^"',;\s}]+''',
        caseSensitive: false,
      ),
      r'$1[REDACTED]',
    ),
    // Cookies: atlas_at=…, atlas_rt=…
    (RegExp(r'(atlas_(?:at|rt)=)[^;\s]+'), r'$1[REDACTED]'),
    // Signed media URLs: …?exp=…&sig=…
    (RegExp(r'([?&]sig=)[^&\s"]+'), r'$1[REDACTED]'),
    // Stylist conversation ids in request paths
    (RegExp(r'(/stylist/conversations/)[^/?\s]+'), r'$1[id]'),
    // Bare JWTs
    (RegExp(r'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'), '[REDACTED_JWT]'),
  ];

  /// Removes tokens, passwords, cookies, signed-URL signatures and JWTs.
  static String redact(String input) {
    var out = input;
    for (final (pattern, replacement) in _patterns) {
      out = out.replaceAllMapped(
        pattern,
        (m) => replacement.replaceAllMapped(RegExp(r'\$(\d)'), (g) => m.group(int.parse(g.group(1)!)) ?? ''),
      );
    }
    return out;
  }
}

enum _Level {
  debug('D'),
  info('I'),
  warn('W'),
  error('E');

  const _Level(this.tag);
  final String tag;
}
