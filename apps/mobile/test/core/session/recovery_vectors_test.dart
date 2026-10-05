// docs/api/client-recovery-vectors.json — every vector, run twice:
//  1. against the pure episode logic (`runRecoveryEpisode`), counting refresh
//     calls and original-request retries exactly like the backend's
//     apps/web/tests/unit/recovery-vectors.test.ts does for the web client;
//  2. end to end through the real stack (SessionController, the session
//     interceptor, the generated client, secure storage) against a fake
//     backend, counting the requests that reach the server.
//
// SESSION_RACE vectors that list `originalRetryStatuses` describe another
// party having rotated the session (web: another tab's cookies). On mobile
// that party is another writer of secure storage, so the race reply comes
// with a newer pair in storage; the vectors' mobile column says to use it.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:atlas_api/atlas_api.dart' show MeResponse;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/recovery.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

typedef Step = Map<String, Object?>;

class Vector {
  Vector(this.json);
  final Map<String, Object?> json;
  String get id => json['id']! as String;
  List<Step> get steps => (json['refreshResponses']! as List).cast<Step>();
  List<String>? get eachOf => (json['refreshResponsesEachOf'] as List?)?.cast<String>();
  List<int> get originalRetryStatuses => ((json['originalRetryStatuses'] as List?) ?? const []).cast<int>();
  Map<String, Object?> get expected => json['expected']! as Map<String, Object?>;

  /// One concrete step list per terminal code for V05, else just [steps].
  List<(String, List<Step>)> expand() {
    final codes = eachOf;
    if (codes == null) return [(id, steps)];
    return [
      for (final code in codes)
        (
          '$id/$code',
          [
            for (final s in steps) s['code'] == '<each terminal code>' ? {...s, 'code': code} : s,
          ],
        ),
    ];
  }
}

final _doc = jsonDecode(File('../../docs/api/client-recovery-vectors.json').readAsStringSync()) as Map<String, Object?>;
final _rules = _doc['rules']! as Map<String, Object?>;
final _vectors = [for (final v in _doc['vectors']! as List) Vector(v as Map<String, Object?>)];

FakeReply replyFor(Step s, int n) {
  if (s['network'] != null) return TransportFailure(DioExceptionType.receiveTimeout);
  final status = s['status']! as int;
  if (status == 200) return JsonReply(200, pairJson(n, issuedAt: t0.add(Duration(minutes: n))));
  return JsonReply(
    status,
    errorBody(s['code']! as String),
    headers: {if (s['retryAfterSeconds'] != null) 'Retry-After': '${s['retryAfterSeconds']}'},
  );
}

ApiFailure failureFor(Step s) {
  if (s['network'] != null) return const TimeoutFailure('receive');
  final code = s['code']! as String;
  final retry = s['retryAfterSeconds'] as int?;
  return ApiHttpFailure(
    statusCode: s['status']! as int,
    code: ApiErrorCode.fromWire(code),
    rawCode: code,
    retryAfter: retry == null ? null : Duration(seconds: retry),
  );
}

String episodeName(EpisodeResult r) => switch (r) {
  EpisodeRecovered() => 'recovered',
  EpisodeLoginRequired() => 'login',
  EpisodeBusy() => 'busy',
  EpisodeOffline() => 'offline',
  EpisodeStorageFailure() => 'storage',
};

void main() {
  test('the vector file is the expected contract version with nine vectors', () {
    expect(_doc['version'], 1);
    expect(_vectors.map((v) => v.id), [
      'V01-refreshed',
      'V02-race-then-ok',
      'V03-race-retry-401-then-refreshed',
      'V04-race-twice',
      'V05-terminal',
      'V06-busy-then-ok',
      'V07-busy-three-times',
      'V08-network-then-ok',
      'V09-network-three-times',
    ]);
  });

  test('the rules match the implementation', () {
    expect(_rules['maxRefreshAttemptsPerEpisode'], RecoveryRules.maxRefreshAttemptsPerEpisode);
    expect(_rules['coolDownAfterFailedEpisodeMs'], RecoveryRules.coolDownAfterFailedEpisode.inMilliseconds);
    expect(_rules['networkRetryWindowMs'], RecoveryRules.networkRetryWindow.inMilliseconds);
    expect(_rules['networkRetryDelaysMs'], RecoveryRules.networkRetryDelays.map((d) => d.inMilliseconds).toList());
    expect(_rules['neverCallLogoutOnFailure'], RecoveryRules.neverCallLogoutOnFailure);
    expect((_rules['terminalCodes']! as List).toSet(), RecoveryRules.terminalCodes.map((c) => c.wire).toSet());
    // Phase 3.2's generic retry policy uses the same network schedule.
    const policy = RetryPolicy();
    expect(policy.networkRetryDelays, RecoveryRules.networkRetryDelays);
    expect(policy.networkRetryWindow, RecoveryRules.networkRetryWindow);
  });

  test('every terminal code is classified as terminal (and maps to sign-in)', () {
    for (final code in RecoveryRules.terminalCodes) {
      expect(code.isTerminalSession, isTrue, reason: code.wire);
      final outcome = classifyRefreshFailure(ApiHttpFailure(statusCode: 401, code: code));
      expect(outcome, isA<RefreshRejected>(), reason: code.wire);
    }
  });

  group('pure episode logic', () {
    for (final v in _vectors) {
      for (final (name, steps) in v.expand()) {
        test(name, () async {
          final queue = [...steps];
          final retries = [...v.originalRetryStatuses];
          final otherWriter = v.originalRetryStatuses.isNotEmpty;
          var refreshCalls = 0;
          var originalRetries = 0;
          var t = Duration.zero;
          final result = await runRecoveryEpisode(
            EpisodeDeps(
              refresh: () async {
                refreshCalls++;
                if (queue.isEmpty) fail('$name: more refresh calls than the vector lists');
                final s = queue.removeAt(0);
                if (s['status'] == 200) return RefreshSucceeded(pair(refreshCalls));
                return classifyRefreshFailure(failureFor(s));
              },
              adoptNewerStoredPair: () async => otherWriter,
              retryOriginal: () async {
                originalRetries++;
                final status = retries.isEmpty ? 200 : retries.removeAt(0);
                final options = RequestOptions(path: P.me);
                final response = Response<dynamic>(requestOptions: options, statusCode: status);
                return status == 200
                    ? response
                    : DioException(requestOptions: options, response: response, type: DioExceptionType.badResponse);
              },
              sleep: (d) async => t += d,
              now: () => t,
              random: Random(1),
            ),
          );
          // The caller re-sends its request once after a refresh-based recovery.
          if (result is EpisodeRecovered && result.probe == null) originalRetries++;
          expect({
            'episode': episodeName(result),
            'refreshCalls': refreshCalls,
            'originalRetries': originalRetries,
          }, v.expected);
        });
      }
    }
  });

  group('end to end (controller + interceptor + generated client + storage)', () {
    for (final v in _vectors) {
      for (final (name, steps) in v.expand()) {
        test(name, () async {
          final h = SessionHarness(stored: pair(1));
          await h.session.restore();
          expect(h.session.state, isA<Authenticated>());

          var raceCount = 0;
          final refreshReplies = <FakeReply>[];
          for (var i = 0; i < steps.length; i++) {
            refreshReplies.add(replyFor(steps[i], 10 + i));
          }
          h.backend.script(P.refresh, refreshReplies);
          h.backend.sideEffects[P.refresh] = (call) {
            final step = steps[call - 1];
            if (step['code'] == 'SESSION_RACE' && v.originalRetryStatuses.isNotEmpty) {
              raceCount++;
              h.kv.put(pair(50 + raceCount)); // another writer saved a newer pair
            }
          };
          // First /me: 401 (starts the episode); then the vector's
          // original-retry statuses; then 200.
          h.backend.script(P.me, [
            JsonReply(401, errorBody('UNAUTHORIZED')),
            for (final status in v.originalRetryStatuses)
              status == 200 ? JsonReply(200, meJson()) : JsonReply(status, errorBody('UNAUTHORIZED')),
            JsonReply(200, meJson()),
          ]);

          final result = await h.tryMe();
          final refreshCalls = h.backend.calls(P.refresh);
          final originalRetries = h.backend.calls(P.me) - 1;
          final episode = switch (result) {
            MeResponse() => 'recovered',
            SessionEndedFailure() => 'login',
            ApiHttpFailure(code: ApiErrorCode.sessionBusy) => 'busy',
            TimeoutFailure() || NoNetworkFailure() || ApiUnreachableFailure() => 'offline',
            _ => 'unexpected: $result',
          };
          expect({'episode': episode, 'refreshCalls': refreshCalls, 'originalRetries': originalRetries}, v.expected);

          // Never a logout call because of a failure.
          expect(h.backend.calls(P.logout), 0);
          switch (episode) {
            case 'login':
              expect(h.kv.values, isEmpty, reason: 'local tokens are deleted');
              expect(h.session.state, isA<SessionExpired>());
              expect(await h.session.currentAccessToken(), isNull);
            case 'busy' || 'offline':
              expect(h.kv.stored?.refreshToken, refresh(1), reason: 'tokens are kept');
              expect(h.session.state, isA<Authenticated>());
            case 'recovered':
              expect(h.session.state, isA<Authenticated>());
              final active = await h.session.currentAccessToken();
              expect(h.kv.stored?.accessToken, active, reason: 'memory and storage hold the same pair');
          }
          // A network retry presents the same refresh token (never a new one).
          if (steps.first['network'] != null) {
            expect(h.presentedRefreshTokens().toSet(), {refresh(1)});
          }
        });
      }
    }
  });

  group('details the counts do not show', () {
    test('V06: waits Retry-After plus 0–500 ms jitter before the next refresh', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
        JsonReply(200, pairJson(2)),
      ]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await h.getMe();
      expect(h.sleeps, hasLength(1));
      expect(h.sleeps.single.inMilliseconds, inInclusiveRange(1000, 1500));
    });

    test('V07/V09: a failed episode starts a 30 s cool-down without refreshes; then one more episode', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [TransportFailure(DioExceptionType.connectionTimeout)]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      expect(await h.tryMe(), isA<TimeoutFailure>());
      expect(h.backend.calls(P.refresh), 3);
      expect(h.sleeps, [const Duration(seconds: 1), const Duration(seconds: 2)]);

      h.advance(const Duration(seconds: 20));
      expect(await h.tryMe(), isA<TimeoutFailure>());
      expect(h.backend.calls(P.refresh), 3, reason: 'cool-down: no automatic refresh');

      h.advance(const Duration(seconds: 11));
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      expect(await h.tryMe(), isA<MeResponse>());
      // V09: the next episode presents the same (kept) token once.
      expect(h.presentedRefreshTokens(), [refresh(1), refresh(1), refresh(1), refresh(1)]);
    });

    test('V09: network retries stop at the 45 s window', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      // Each refresh attempt takes 30 s (deadline) before failing.
      h.backend.handlers[P.refresh] = (_) {
        h.advance(const Duration(seconds: 30));
        return TransportFailure(DioExceptionType.receiveTimeout);
      };
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      expect(await h.tryMe(), isA<TimeoutFailure>());
      // 30 s + 1 s → second attempt at 31 s; 31 + 30 + 2 > 45 → stop.
      expect(h.backend.calls(P.refresh), 2);
    });

    test('race with the same stored token (mobile V02): wait 1 s, refresh once more, then success', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_RACE')), JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      expect(await h.tryMe(), isA<MeResponse>());
      expect(h.sleeps, [RecoveryRules.raceSameTokenDelay]);
      expect(h.presentedRefreshTokens(), [refresh(1), refresh(1)]);
      expect(h.backend.calls(P.me), 2, reason: 'no pointless re-send with the old access token');
      expect(h.kv.stored?.refreshToken, refresh(2));
    });

    test('race twice with the same stored token: tokens deleted, sign-in, no third refresh', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_RACE'))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final result = await h.tryMe();
      expect(result, isA<SessionEndedFailure>());
      expect((result as SessionEndedFailure).reason, SignedOutReason.raced);
      expect(h.backend.calls(P.refresh), 2);
      expect(h.kv.values, isEmpty);
      expect(h.session.state, const SessionExpired(SignedOutReason.raced));
    });

    test('race: a newer pair in storage is used without another refresh (expired access at startup)', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_RACE'))]);
      h.backend.sideEffects[P.refresh] = (_) => h.kv.put(pair(2, issuedAt: t0.add(const Duration(minutes: 1))));
      h.backend.script(P.me, [JsonReply(200, meJson())]);
      await h.session.restore();
      expect(h.session.state, isA<Authenticated>());
      expect(await h.tryMe(), isA<MeResponse>());
      expect(h.backend.calls(P.refresh), 1);
      expect(h.bearers(P.me), ['Bearer ${access(2)}']);
    });
  });
}
