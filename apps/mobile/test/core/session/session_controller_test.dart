import 'dart:convert';

import 'package:atlas_api/atlas_api.dart' show MeResponse;
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

Map<String, Object?> bodyOf(SentRequest r) => jsonDecode(r.bodyText) as Map<String, Object?>;

/// Records every state the controller passes through.
List<AuthState> recordStates(SessionHarness h) {
  final states = <AuthState>[];
  h.session.addListener(() => states.add(h.session.state));
  return states;
}

void main() {
  group('login', () {
    test('success: mobile header, credentials in the body, pair stored BEFORE Authenticated', () async {
      final h = SessionHarness();
      await h.session.restore();
      expect(h.session.state, const Unauthenticated());
      h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
      var storedWhenAuthenticated = false;
      h.session.addListener(() {
        if (h.session.state is Authenticated) storedWhenAuthenticated = h.kv.stored?.refreshToken == refresh(1);
      });
      final states = recordStates(h);

      await h.session.login(email: 'a@test.local', password: 'secret-pw');

      final r = h.backend.to(P.login).single;
      expect(r.header('X-Atlas-Client'), 'mobile');
      expect(r.header('Authorization'), isNull);
      expect(r.header('Cookie'), isNull);
      expect(bodyOf(r), {'email': 'a@test.local', 'password': 'secret-pw', 'deviceName': 'Test device'});
      expect(states, [const Authenticating(), isA<Authenticated>()]);
      expect(storedWhenAuthenticated, isTrue);
      expect(await h.session.currentAccessToken(), access(1));
      expect(h.kv.stored?.sessionExpiresAt, t0.add(const Duration(days: 90)));
    });

    test('wrong credentials (401 UNAUTHORIZED): failure, no refresh, state back to signed out', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.login, [JsonReply(401, errorBody('UNAUTHORIZED', error: 'Email yoki parol noto‘g‘ri'))]);
      await expectLater(
        h.session.login(email: 'a@test.local', password: 'x'),
        throwsA(isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.unauthorized)),
      );
      expect(h.backend.calls(P.refresh), 0);
      expect(h.session.state, const Unauthenticated());
      expect(h.kv.values, isEmpty);
    });

    test('validation failure (400) carries the field errors', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.login, [
        JsonReply(
          400,
          errorBody(
            'VALIDATION_ERROR',
            details: [
              {'path': 'email', 'message': 'Email noto‘g‘ri'},
            ],
          ),
        ),
      ]);
      await expectLater(
        h.session.login(email: 'bad', password: 'x'),
        throwsA(isA<ApiHttpFailure>().having((f) => f.fieldErrors.single.path, 'field', 'email')),
      );
      expect(h.session.state, const Unauthenticated());
    });

    test('network failure: NoNetwork when the device is offline, nothing stored', () async {
      final h = SessionHarness(online: false);
      await h.session.restore();
      h.backend.script(P.login, [TransportFailure(DioExceptionType.connectionError)]);
      await expectLater(h.session.login(email: 'a@test.local', password: 'x'), throwsA(isA<NoNetworkFailure>()));
      expect(h.session.state, const Unauthenticated());
      expect(h.kv.values, isEmpty);
    });

    test('server error (500): failure, not authenticated', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.login, [JsonReply(500, errorBody('INTERNAL'))]);
      await expectLater(h.session.login(email: 'a@test.local', password: 'x'), throwsA(isA<ApiHttpFailure>()));
      expect(h.session.state, const Unauthenticated());
    });

    test('a 200 without tokens (web-mode body) is a contract failure, not a session', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.login, [
        JsonReply(200, {'user': sessionUserJson()}),
      ]);
      await expectLater(
        h.session.login(email: 'a@test.local', password: 'x'),
        throwsA(isA<UnexpectedResponseFailure>()),
      );
      expect(h.session.state, const Unauthenticated());
      expect(h.kv.values, isEmpty);
    });

    test('secure storage failure: NOT authenticated, the new server session is logged out', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
      h.backend.script(P.logout, [
        JsonReply(200, {'ok': true}),
      ]);
      h.kv.failWrites = true;
      await expectLater(h.session.login(email: 'a@test.local', password: 'x'), throwsA(isA<SecureStorageFailure>()));
      expect(h.session.state, const Unauthenticated());
      expect(await h.session.currentAccessToken(), isNull);
      await pumpEventQueue();
      expect(bodyOf(h.backend.to(P.logout).single), {'refreshToken': refresh(1)});
    });

    test('a failed sign-in keeps the "session expired" explanation on the screen', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
      await h.session.restore();
      expect(h.session.state, const SessionExpired(SignedOutReason.reused));
      h.backend.script(P.login, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await expectLater(h.session.login(email: 'a@test.local', password: 'x'), throwsA(isA<ApiFailure>()));
      expect(h.session.state, const SessionExpired(SignedOutReason.reused));
    });
  });

  group('register', () {
    test('201 with a mobile session: stored and authenticated (same as login)', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.register, [JsonReply(201, pairJson(1))]);
      await h.session.register(email: 'new@test.local', password: 'long-enough', name: 'Ali');
      final r = h.backend.to(P.register).single;
      expect(r.header('X-Atlas-Client'), 'mobile');
      expect(bodyOf(r), {
        'email': 'new@test.local',
        'password': 'long-enough',
        'name': 'Ali',
        'deviceName': 'Test device',
      });
      expect(h.session.state, isA<Authenticated>());
      expect(h.kv.stored?.refreshToken, refresh(1));
    });

    test('409 CONFLICT (email taken): failure, not authenticated', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.register, [JsonReply(409, errorBody('CONFLICT'))]);
      await expectLater(
        h.session.register(email: 'a@test.local', password: 'long-enough'),
        throwsA(isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.conflict)),
      );
      expect(h.session.state, const Unauthenticated());
    });

    test('the name is omitted when not given', () async {
      final h = SessionHarness();
      await h.session.restore();
      h.backend.script(P.register, [JsonReply(201, pairJson(1))]);
      await h.session.register(email: 'n@test.local', password: 'long-enough');
      expect(bodyOf(h.backend.to(P.register).single).containsKey('name'), isFalse);
    });
  });

  group('refresh', () {
    test('expired access token: refreshed BEFORE the request, new pair stored, then the request', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.advance(const Duration(minutes: 15));
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2, issuedAt: h.wall))]);
      h.backend.script(P.me, [JsonReply(200, meJson())]);
      expect(await h.getMe(), isA<MeResponse>());
      final refreshRequest = h.backend.to(P.refresh).single;
      expect(refreshRequest.header('X-Atlas-Client'), 'mobile');
      expect(refreshRequest.header('Authorization'), isNull);
      expect(refreshRequest.header('Cookie'), isNull);
      expect(bodyOf(refreshRequest), {'refreshToken': refresh(1)});
      expect(h.bearers(P.me), ['Bearer ${access(2)}']);
      expect(h.kv.stored?.refreshToken, refresh(2));
      // Rotation never extends the 90-day family limit.
      expect(h.kv.stored?.sessionExpiresAt, t0.add(const Duration(days: 90)));
    });

    test('state goes Authenticated → Refreshing → Authenticated (router stays put)', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      final states = recordStates(h);
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await h.getMe();
      expect(states, [isA<Refreshing>(), isA<Authenticated>()]);
    });

    test('the refresh token is read from secure storage (the latest one)', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.kv.put(pair(5)); // e.g. written by an earlier run that crashed after saving
      h.backend.script(P.refresh, [JsonReply(200, pairJson(6))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await h.getMe();
      expect(h.presentedRefreshTokens(), [refresh(5)]);
    });

    for (final (code, reason) in [
      ('REFRESH_REUSED', SignedOutReason.reused),
      ('SESSION_REVOKED', SignedOutReason.revoked),
      ('SESSION_EXPIRED', SignedOutReason.expired),
    ]) {
      test('$code is terminal: tokens deleted, memory cleared, sign-in with a reason, no retry, no logout', () async {
        final h = SessionHarness(stored: pair(1));
        await h.session.restore();
        h.backend.script(P.refresh, [JsonReply(401, errorBody(code))]);
        h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
        final result = await h.tryMe();
        expect(result, isA<SessionEndedFailure>().having((f) => f.reason, 'reason', reason));
        expect(h.backend.calls(P.refresh), 1);
        expect(h.backend.calls(P.logout), 0);
        expect(h.kv.values, isEmpty);
        expect(await h.session.currentAccessToken(), isNull);
        expect(h.session.state, SessionExpired(reason));
        // Later authenticated requests are not sent at all.
        final later = await h.tryMe();
        expect(later, isA<SessionEndedFailure>());
        expect(h.backend.calls(P.me), 1);
        expect(h.backend.calls(P.refresh), 1, reason: 'the compromised token is never presented again');
      });
    }

    test('SESSION_BUSY three times: temporary error, session kept, no logout', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '2'}),
      ]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final result = await h.tryMe();
      expect(result, isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.sessionBusy));
      expect((result as ApiFailure).userMessage, contains('band'));
      expect(h.backend.calls(P.refresh), 3);
      // Retry-After (2 s) + jitter ≤ 500 ms, twice.
      expect(h.sleeps, hasLength(2));
      for (final s in h.sleeps) {
        expect(s.inMilliseconds, inInclusiveRange(2000, 2500));
      }
      expect(h.session.state, isA<Authenticated>());
      expect(h.kv.stored?.refreshToken, refresh(1));
    });

    test('a huge Retry-After is capped at 10 s', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '3600'}),
        JsonReply(200, pairJson(2)),
      ]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await h.getMe();
      expect(h.sleeps.single.inMilliseconds, inInclusiveRange(10000, 10500));
    });

    test('timeout then success: the SAME refresh token is presented again (no extra rotation)', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [TransportFailure(DioExceptionType.receiveTimeout), JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      expect(await h.getMe(), isA<MeResponse>());
      expect(h.presentedRefreshTokens(), [refresh(1), refresh(1)]);
      expect(h.sleeps, [const Duration(seconds: 1)]);
      expect(h.kv.stored?.refreshToken, refresh(2));
    });

    test('a refresh that never answers is cut off by the 12 s deadline and counted as a timeout', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.gates[P.refresh] = Gate(); // never opened
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final result = await h.tryMe().timeout(const Duration(seconds: 60));
      expect(result, isA<TimeoutFailure>());
      expect(h.backend.calls(P.refresh), 3);
      expect(h.kv.stored?.refreshToken, refresh(1), reason: 'tokens kept');
    }, timeout: const Timeout(Duration(seconds: 90)));

    test('storage failure while saving the new pair: old pair kept, request fails, not signed out', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      h.kv.failWrites = true;
      final result = await h.tryMe();
      expect(result, isA<SecureStorageFailure>());
      expect(h.kv.stored?.refreshToken, refresh(1));
      expect(await h.session.currentAccessToken(), access(1), reason: 'no mixed pair: the old pair stays active');
      expect(h.session.state, isA<Authenticated>());

      // Storage works again: the next refresh (grace replay of pair 2) is saved.
      h.kv.failWrites = false;
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      expect(await h.getMe(), isA<MeResponse>());
      expect(h.kv.stored?.refreshToken, refresh(2));
    });

    test('a request that got 401 with an older pair is re-sent without another refresh', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      final slow = Gate();
      var meCalls = 0;
      h.backend.handlers[P.me] = (r) async {
        meCalls++;
        if (meCalls == 1) {
          await slow.future; // sent with pair 1, answered after the refresh
          return JsonReply(401, errorBody('UNAUTHORIZED'));
        }
        if (meCalls == 2) return JsonReply(401, errorBody('UNAUTHORIZED'));
        return JsonReply(200, meJson());
      };
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      final first = h.tryMe();
      await pumpEventQueue();
      expect(await h.tryMe(), isA<MeResponse>()); // 401 → refresh → retry
      slow.open();
      expect(await first, isA<MeResponse>());
      expect(h.backend.calls(P.refresh), 1);
    });

    test('a retried request that still gets 401 is returned as is (no refresh loop)', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final result = await h.tryMe();
      expect(result, isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.unauthorized));
      expect(h.backend.calls(P.refresh), 1);
      expect(h.backend.calls(P.me), 2);
      expect(h.session.state, isA<Authenticated>(), reason: 'never a logout because of a failure');
    });

    test('public endpoints never trigger a refresh', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script('/api/health', [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      final result = await h.client
          .call((api) => api.getServiceApi().getHealth())
          .then<Object>((v) => v, onError: (Object e) => e);
      expect(result, isA<ApiHttpFailure>());
      expect(h.backend.calls(P.refresh), 0);
      expect(h.backend.to('/api/health').single.header('Authorization'), isNull);
    });
  });

  group('logout', () {
    test('success: refresh token in the body, mobile header, no cookie, storage cleared', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.logout, [
        JsonReply(200, {'ok': true}),
      ]);
      final states = recordStates(h);
      await h.session.logout();
      final r = h.backend.to(P.logout).single;
      expect(r.header('X-Atlas-Client'), 'mobile');
      expect(r.header('Cookie'), isNull);
      expect(bodyOf(r), {'refreshToken': refresh(1)});
      expect(h.kv.values, isEmpty);
      expect(await h.session.currentAccessToken(), isNull);
      expect(states, [isA<LoggingOut>(), const Unauthenticated(SignedOutReason.loggedOut)]);
    });

    test('server unavailable: local credentials are still cleared', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.logout, [TransportFailure(DioExceptionType.connectionError)]);
      await h.session.logout();
      expect(h.backend.calls(P.logout), 1);
      expect(h.kv.values, isEmpty);
      expect(h.session.state, const Unauthenticated(SignedOutReason.loggedOut));
    });

    test('offline: no server call, local credentials cleared', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.network.online = false;
      await h.session.logout();
      expect(h.backend.calls(P.logout), 0);
      expect(h.kv.values, isEmpty);
      expect(h.session.state, const Unauthenticated(SignedOutReason.loggedOut));
    });

    test('SESSION_BUSY: retried once after Retry-After', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.logout, [
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
        JsonReply(200, {'ok': true}),
      ]);
      await h.session.logout();
      expect(h.backend.calls(P.logout), 2);
      expect(h.kv.values, isEmpty);
    });

    test('a request still in flight with the old token does not survive the logout', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.gates[P.me] = Gate();
      h.backend.script(P.me, [JsonReply(200, meJson())]);
      h.backend.script(P.logout, [
        JsonReply(200, {'ok': true}),
      ]);
      final pending = h.tryMe();
      await pumpEventQueue();
      await h.session.logout();
      final result = await pending;
      expect(result, isA<SessionEndedFailure>());
      // And nothing new is sent with the old token.
      expect(await h.tryMe(), isA<SessionEndedFailure>());
      expect(h.backend.calls(P.me), 1);
    });
  });

  group('startup', () {
    test('no stored session → Unauthenticated', () async {
      final h = SessionHarness();
      await h.session.restore();
      expect(h.session.state, const Unauthenticated());
      expect(h.backend.sent, isEmpty);
    });

    test('valid access token → Authenticated without any network call', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      expect(h.session.state, isA<Authenticated>());
      expect(h.backend.sent, isEmpty);
      expect(await h.session.currentAccessToken(), access(1));
    });

    test('expired access + valid refresh → one controlled refresh, then Authenticated', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      await h.session.restore();
      expect(h.backend.calls(P.refresh), 1);
      expect(h.session.state, isA<Authenticated>());
      expect(h.kv.stored?.refreshToken, refresh(2));
    });

    test('family expired locally (90-day limit passed) → credentials cleared, no network', () async {
      final h = SessionHarness(stored: pair(1, sessionExpiresAt: t0.subtract(const Duration(seconds: 1))));
      await h.session.restore();
      expect(h.session.state, const SessionExpired(SignedOutReason.expired));
      expect(h.kv.values, isEmpty);
      expect(h.backend.sent, isEmpty);
    });

    test('family expired on the server (SESSION_EXPIRED) → credentials cleared', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_EXPIRED'))]);
      await h.session.restore();
      expect(h.session.state, const SessionExpired(SignedOutReason.expired));
      expect(h.kv.values, isEmpty);
    });

    test('revoked session (SESSION_REVOKED) → credentials cleared', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_REVOKED'))]);
      await h.session.restore();
      expect(h.session.state, const SessionExpired(SignedOutReason.revoked));
      expect(h.kv.values, isEmpty);
    });

    test('offline startup with an expired access token: session kept, no refresh, Authenticated', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero), online: false);
      await h.session.restore();
      expect(h.backend.sent, isEmpty);
      expect(h.session.state, isA<Authenticated>());
      expect(h.kv.stored?.refreshToken, refresh(1));
    });

    test('API unreachable at startup: refresh fails as offline, session kept', () async {
      final h = SessionHarness(stored: pair(1, accessTtl: Duration.zero));
      h.backend.script(P.refresh, [TransportFailure(DioExceptionType.connectionError)]);
      await h.session.restore();
      expect(h.session.state, isA<Authenticated>());
      expect(h.kv.stored?.refreshToken, refresh(1));
    });

    test('the splash never waits longer than startupWait for a slow refresh', () async {
      final h = SessionHarness(
        stored: pair(1, accessTtl: Duration.zero),
        startupWait: const Duration(milliseconds: 50),
      );
      final gate = Gate();
      h.backend.gates[P.refresh] = gate;
      h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
      await h.session.restore();
      expect(h.session.state, isA<Authenticated>(), reason: 'shown while the refresh continues');
      gate.open();
      await pumpEventQueue();
      expect(h.session.state, const SessionExpired(SignedOutReason.reused), reason: 'the late result still applies');
    });

    test('unreadable secure storage: not deleted, signed out with an explanation', () async {
      final h = SessionHarness(stored: pair(1));
      h.kv.failReads = true;
      await h.session.restore();
      expect(h.session.state, const Unauthenticated(SignedOutReason.storageUnavailable));
      h.kv.failReads = false;
      expect(h.kv.stored?.refreshToken, refresh(1));
    });

    test('a corrupt stored value is removed → Unauthenticated', () async {
      final h = SessionHarness();
      h.kv.values['atlas.session.v1'] = '{not json';
      await h.session.restore();
      expect(h.session.state, const Unauthenticated());
      expect(h.kv.values, isEmpty);
    });
  });
}
