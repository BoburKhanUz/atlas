import 'package:flutter/foundation.dart';

/// Minimal logger. Every message goes through [redact] first, and nothing is
/// emitted in release builds. Never log request/response bodies of auth
/// endpoints; even redacted, keep logs to ids, codes and timings.
abstract final class AppLog {
  /// Replaced in tests to capture output.
  @visibleForTesting
  static void Function(String line) sink = _debugSink;

  /// Forced on/off in tests; defaults to "not a release build".
  @visibleForTesting
  static bool? enabledOverride;

  static bool get enabled => enabledOverride ?? !kReleaseMode;

  static void debug(String message) => _emit('D', message);
  static void info(String message) => _emit('I', message);
  static void warn(String message) => _emit('W', message);
  static void error(String message, [Object? error]) =>
      _emit('E', error == null ? message : '$message: ${error.runtimeType}');

  static void _emit(String level, String message) {
    if (!enabled) return;
    sink('[atlas][$level] ${redact(message)}');
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
