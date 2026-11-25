import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Monotonic time: a change of the device clock never moves it. Tests
/// replace it.
final monotonicClockProvider = Provider<Duration Function()>((ref) {
  final watch = Stopwatch()..start();
  return () => watch.elapsed;
});

/// Waits (a deferred refresh); tests replace it.
final delayProvider = Provider<Future<void> Function(Duration)>((ref) => Future<void>.delayed);

/// How often expired signed image URLs are reloaded at most.
const signedUrlRefreshInterval = Duration(seconds: 30);

/// Runs a refresh at most once per [interval]. Callers that ask while one
/// runs share it. A request inside the interval is not dropped: [later] is
/// called once when the interval is over (the caller decides then whether a
/// refresh is still wanted).
///
/// Used for expired signed image URLs: many tiles report at once, a tile
/// reports a given URL only once, and a wrong clock must not cause a loop.
class RefreshThrottle {
  RefreshThrottle({required this.interval, required this.now, required this.delay});

  /// A throttle for expired signed image URLs, on [ref]'s clock; disposed with [ref].
  factory RefreshThrottle.forSignedUrls(Ref ref) {
    final throttle = RefreshThrottle(
      interval: signedUrlRefreshInterval,
      now: ref.read(monotonicClockProvider),
      delay: ref.read(delayProvider),
    );
    ref.onDispose(throttle.dispose);
    return throttle;
  }

  final Duration interval;

  /// Monotonic time ([monotonicClockProvider]).
  final Duration Function() now;
  final Future<void> Function(Duration) delay;
  Future<void>? _running;
  Duration? _last;
  bool _deferred = false;
  bool _disposed = false;

  bool get running => _running != null;

  /// [action] now, unless one is running (its future is returned) or the
  /// last one ended less than [interval] ago (then [later] is scheduled).
  /// [force] (an explicit retry by the user) skips the interval.
  Future<void> run(Future<void> Function() action, {required void Function() later, bool force = false}) {
    final running = _running;
    if (running != null) return running;
    final last = _last;
    if (!force && last != null) {
      final rest = interval - (now() - last);
      if (rest > Duration.zero) {
        _defer(rest, later);
        return Future.value();
      }
    }
    return _running = action().whenComplete(() {
      _running = null;
      _last = now();
    });
  }

  void _defer(Duration wait, void Function() later) {
    if (_deferred) return;
    _deferred = true;
    unawaited(
      delay(wait).then((_) {
        _deferred = false;
        if (!_disposed) later();
      }),
    );
  }

  /// No [later] call after this (the owner is gone or starts afresh).
  void dispose() => _disposed = true;
}
