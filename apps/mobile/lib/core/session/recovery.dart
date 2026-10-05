import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../network/api_error_code.dart';
import '../network/api_failure.dart';
import 'auth_state.dart';
import 'session_tokens.dart';

/// The rules of docs/api/client-recovery-vectors.json (`rules`), checked
/// against that file by test/core/session/recovery_vectors_test.dart.
abstract final class RecoveryRules {
  static const maxRefreshAttemptsPerEpisode = 3;
  static const coolDownAfterFailedEpisode = Duration(seconds: 30);
  static const networkRetryWindow = Duration(seconds: 45);
  static const networkRetryDelays = [Duration(seconds: 1), Duration(seconds: 2)];

  /// Mobile, vector V02: same token after SESSION_RACE → wait 1 s, then the
  /// refresh is retried once (a grace replay may succeed).
  static const raceSameTokenDelay = Duration(seconds: 1);

  /// SESSION_BUSY: Retry-After (default 1 s, at most 10 s) plus 0–500 ms.
  static const busyDefaultRetryAfter = Duration(seconds: 1);
  static const busyMaxRetryAfter = Duration(seconds: 10);
  static const busyMaxJitter = Duration(milliseconds: 500);

  static const terminalCodes = {
    ApiErrorCode.invalidToken,
    ApiErrorCode.sessionExpired,
    ApiErrorCode.sessionRevoked,
    ApiErrorCode.refreshReused,
    ApiErrorCode.clientMismatch,
  };

  /// Never call logout because a refresh failed.
  static const neverCallLogoutOnFailure = true;
}

/// One POST /api/v1/auth/refresh, classified.
@immutable
sealed class RefreshOutcome {
  const RefreshOutcome();
}

/// 200: the new pair is already saved to secure storage and active.
final class RefreshSucceeded extends RefreshOutcome {
  const RefreshSucceeded(this.tokens);
  final SessionTokens tokens;
}

/// 401 SESSION_RACE.
final class RefreshRaced extends RefreshOutcome {
  const RefreshRaced();
}

/// 503 SESSION_BUSY.
final class RefreshBusy extends RefreshOutcome {
  const RefreshBusy(this.retryAfter, this.failure);
  final Duration retryAfter;
  final ApiFailure failure;
}

/// The session cannot be recovered (terminal code, unknown 401, 4xx).
final class RefreshRejected extends RefreshOutcome {
  const RefreshRejected(this.reason, this.failure);
  final SignedOutReason reason;
  final ApiFailure failure;
}

/// No usable answer: timeout, connection error, 5xx (other than
/// SESSION_BUSY). The server may or may not have processed the request.
final class RefreshNetworkError extends RefreshOutcome {
  const RefreshNetworkError(this.failure);
  final ApiFailure failure;
}

/// The server issued a new pair but secure storage refused it. The old pair
/// stays in place (a refresh within 60 s gets the same new pair again as a
/// grace replay).
final class RefreshNotSaved extends RefreshOutcome {
  const RefreshNotSaved();
}

/// Classifies a refresh answer the same way as the web reference
/// (apps/web/src/lib/session-recovery.ts `classifyRefreshResponse`).
RefreshOutcome classifyRefreshFailure(ApiFailure failure) {
  if (failure is ApiHttpFailure) {
    if (failure.statusCode == 503 && failure.code == ApiErrorCode.sessionBusy) {
      var wait = failure.retryAfter ?? RecoveryRules.busyDefaultRetryAfter;
      if (wait <= Duration.zero) wait = RecoveryRules.busyDefaultRetryAfter;
      if (wait > RecoveryRules.busyMaxRetryAfter) wait = RecoveryRules.busyMaxRetryAfter;
      return RefreshBusy(wait, failure);
    }
    if (failure.statusCode == 401 && failure.code == ApiErrorCode.sessionRace) return const RefreshRaced();
    if (failure.statusCode >= 500) return RefreshNetworkError(failure);
    return RefreshRejected(signedOutReasonFor(failure.code), failure);
  }
  // A 4xx that is not an ErrorResponse cannot be recovered; an unreadable
  // 2xx may have rotated the token, so it is retried like a lost answer.
  final status = failure is UnexpectedResponseFailure ? failure.statusCode : null;
  if (status != null && status >= 400 && status < 500) return RefreshRejected(SignedOutReason.rejected, failure);
  return RefreshNetworkError(failure);
}

SignedOutReason signedOutReasonFor(ApiErrorCode code) => switch (code) {
  ApiErrorCode.sessionExpired => SignedOutReason.expired,
  ApiErrorCode.sessionRevoked || ApiErrorCode.invalidToken => SignedOutReason.revoked,
  ApiErrorCode.refreshReused => SignedOutReason.reused,
  ApiErrorCode.clientMismatch => SignedOutReason.clientMismatch,
  _ => SignedOutReason.rejected,
};

/// How a recovery episode ended.
@immutable
sealed class EpisodeResult {
  const EpisodeResult();
}

/// The session is usable again. [probe] is the answer to the caller's own
/// request when the race path already re-sent it (a `Response` or a non-401
/// `DioException`); it belongs to the caller that started the episode only.
final class EpisodeRecovered extends EpisodeResult {
  const EpisodeRecovered({this.probe});
  final Object? probe;
}

/// Sign in again: the local tokens are deleted (no server call).
final class EpisodeLoginRequired extends EpisodeResult {
  const EpisodeLoginRequired(this.reason);
  final SignedOutReason reason;
}

/// SESSION_BUSY three times: keep the session, no automatic refresh for 30 s.
final class EpisodeBusy extends EpisodeResult {
  const EpisodeBusy(this.failure);
  final ApiFailure failure;
}

/// The refresh never got an answer: keep the session (offline), 30 s
/// cool-down.
final class EpisodeOffline extends EpisodeResult {
  const EpisodeOffline(this.failure);
  final ApiFailure failure;
}

/// A new pair could not be saved; the old pair is kept.
final class EpisodeStorageFailure extends EpisodeResult {
  const EpisodeStorageFailure();
}

/// What one episode needs from the outside (tests use fakes and fake time).
class EpisodeDeps {
  EpisodeDeps({
    required this.refresh,
    required this.adoptNewerStoredPair,
    required this.sleep,
    required this.now,
    required this.random,
    this.retryOriginal,
  });

  /// One refresh with the current refresh token (re-read from storage).
  final Future<RefreshOutcome> Function() refresh;

  /// After SESSION_RACE: re-read secure storage. True when it holds a newer
  /// pair than the one just presented (it is now the active pair).
  final Future<bool> Function() adoptNewerStoredPair;

  /// Re-sends the request that got 401 with the current access token;
  /// returns its `Response` or `DioException`. Null for a refresh that was
  /// not triggered by a request (expired access token, startup).
  final Future<Object> Function()? retryOriginal;

  final Future<void> Function(Duration) sleep;

  /// Monotonic time.
  final Duration Function() now;
  final Random random;
}

/// One recovery episode — the mobile column of client-recovery-vectors.json:
///
///   200                    → recovered (the new pair is already saved)
///   401 SESSION_RACE       → re-read secure storage. A newer pair there →
///                            use it: re-send the original request once
///                            (no refresh). Same pair → wait 1 s and refresh
///                            once more with it. Still 401 / a second race →
///                            sign in again.
///   401 terminal codes     → sign in again; no retries
///   503 SESSION_BUSY       → wait Retry-After + 0–500 ms, refresh again
///   timeout / connection   → same refresh token again after 1 s, then 2 s,
///                            only within 45 s of the first attempt
///   at most 3 refresh calls per episode.
Future<EpisodeResult> runRecoveryEpisode(EpisodeDeps deps) async {
  final started = deps.now();
  var networkFailures = 0;
  var racesSeen = 0;
  EpisodeResult last = const EpisodeLoginRequired(SignedOutReason.raced);

  for (var attempt = 1; attempt <= RecoveryRules.maxRefreshAttemptsPerEpisode; attempt++) {
    final outcome = await deps.refresh();
    switch (outcome) {
      case RefreshSucceeded():
        return const EpisodeRecovered();
      case RefreshNotSaved():
        return const EpisodeStorageFailure();
      case RefreshRejected(:final reason):
        return EpisodeLoginRequired(reason);
      case RefreshRaced():
        racesSeen++;
        if (racesSeen > 1) return const EpisodeLoginRequired(SignedOutReason.raced);
        last = const EpisodeLoginRequired(SignedOutReason.raced);
        if (await deps.adoptNewerStoredPair()) {
          final retry = deps.retryOriginal;
          if (retry == null) return const EpisodeRecovered();
          final probe = await retry();
          final unauthorized = probe is DioException && probe.response?.statusCode == 401;
          if (!unauthorized) return EpisodeRecovered(probe: probe);
        } else {
          await deps.sleep(RecoveryRules.raceSameTokenDelay);
        }
        continue; // one more refresh, with the newest stored token
      case RefreshBusy(:final retryAfter, :final failure):
        last = EpisodeBusy(failure);
        if (attempt < RecoveryRules.maxRefreshAttemptsPerEpisode) {
          final jitterMs = deps.random.nextInt(RecoveryRules.busyMaxJitter.inMilliseconds + 1);
          await deps.sleep(retryAfter + Duration(milliseconds: jitterMs));
        }
        continue;
      case RefreshNetworkError(:final failure):
        last = EpisodeOffline(failure);
        final delays = RecoveryRules.networkRetryDelays;
        final delay = delays[min(networkFailures, delays.length - 1)];
        networkFailures++;
        // The same token may be presented again only while the server would
        // still replay its rotation (60 s); the 45 s window keeps us inside.
        if (attempt >= RecoveryRules.maxRefreshAttemptsPerEpisode ||
            deps.now() + delay - started >= RecoveryRules.networkRetryWindow) {
          return last;
        }
        await deps.sleep(delay);
        continue;
    }
  }
  return last;
}
