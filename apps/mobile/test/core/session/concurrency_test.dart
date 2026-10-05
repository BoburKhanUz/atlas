import 'package:atlas_api/atlas_api.dart' show MeResponse;
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  test('expired access token + 5 simultaneous requests → exactly ONE refresh; all use the new token', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.advance(const Duration(minutes: 16)); // access token expired
    final gate = Gate();
    h.backend.gates[P.refresh] = gate;
    h.backend.script(P.refresh, [JsonReply(200, pairJson(2, issuedAt: h.wall))]);
    h.backend.script(P.me, [JsonReply(200, meJson())]);

    final results = [for (var i = 0; i < 5; i++) h.tryMe()];
    await pumpEventQueue();
    expect(h.backend.calls(P.refresh), 1, reason: 'single flight while the refresh is running');
    expect(h.backend.calls(P.me), 0, reason: 'requests wait for the refresh');
    gate.open();

    expect(await Future.wait(results), everyElement(isA<MeResponse>()));
    expect(h.backend.calls(P.refresh), 1);
    expect(h.presentedRefreshTokens(), [refresh(1)], reason: 'the refresh token is used once');
    expect(h.bearers(P.me), List.filled(5, 'Bearer ${access(2)}'));
    expect(h.session.state, isA<Authenticated>());
    expect(h.kv.stored?.refreshToken, refresh(2));
  });

  test('5 simultaneous 401s → ONE refresh; each request re-sent once with the new token', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    final gate = Gate();
    h.backend.gates[P.refresh] = gate;
    h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
    h.backend.handlers[P.me] = (r) => r.header('Authorization') == 'Bearer ${access(2)}'
        ? JsonReply(200, meJson())
        : JsonReply(401, errorBody('UNAUTHORIZED'));

    final results = [for (var i = 0; i < 5; i++) h.tryMe()];
    await pumpEventQueue();
    expect(h.backend.calls(P.refresh), 1);
    gate.open();

    expect(await Future.wait(results), everyElement(isA<MeResponse>()));
    expect(h.backend.calls(P.refresh), 1);
    expect(h.bearers(P.me).where((b) => b == 'Bearer ${access(1)}'), hasLength(5));
    expect(h.bearers(P.me).where((b) => b == 'Bearer ${access(2)}'), hasLength(5));
  });

  test('requests that start while the refresh is running join it (no second refresh)', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.advance(const Duration(minutes: 16));
    final gate = Gate();
    h.backend.gates[P.refresh] = gate;
    h.backend.script(P.refresh, [JsonReply(200, pairJson(2, issuedAt: h.wall))]);
    h.backend.script(P.me, [JsonReply(200, meJson())]);

    final early = [for (var i = 0; i < 2; i++) h.tryMe()];
    await pumpEventQueue();
    final late = [for (var i = 0; i < 3; i++) h.tryMe()];
    await pumpEventQueue();
    gate.open();
    expect(await Future.wait([...early, ...late]), everyElement(isA<MeResponse>()));
    expect(h.backend.calls(P.refresh), 1);
  });

  test('terminal answer while 5 requests wait: all fail as "session ended", one refresh, tokens gone', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.advance(const Duration(minutes: 16));
    h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
    h.backend.script(P.me, [JsonReply(200, meJson())]);

    final results = await Future.wait([for (var i = 0; i < 5; i++) h.tryMe()]);
    expect(results, everyElement(isA<SessionEndedFailure>()));
    expect(h.backend.calls(P.refresh), 1);
    expect(h.backend.calls(P.me), 0);
    expect(h.kv.values, isEmpty);
    expect(h.session.state, const SessionExpired(SignedOutReason.reused));
  });

  test('SESSION_RACE while 5 requests wait: one episode for all of them (2 refresh calls total)', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.advance(const Duration(minutes: 16));
    h.backend.script(P.refresh, [
      JsonReply(401, errorBody('SESSION_RACE')),
      JsonReply(200, pairJson(2, issuedAt: h.wall)),
    ]);
    h.backend.script(P.me, [JsonReply(200, meJson())]);

    final results = await Future.wait([for (var i = 0; i < 5; i++) h.tryMe()]);
    expect(results, everyElement(isA<MeResponse>()));
    expect(h.backend.calls(P.refresh), 2);
  });

  test('after a failed (busy) episode, concurrent requests within 30 s do not refresh at all', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.advance(const Duration(minutes: 16));
    h.backend.script(P.refresh, [
      JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
    ]);
    await h.tryMe();
    expect(h.backend.calls(P.refresh), 3);
    final results = await Future.wait([for (var i = 0; i < 5; i++) h.tryMe()]);
    expect(results, everyElement(isA<ApiHttpFailure>()));
    expect(h.backend.calls(P.refresh), 3);
    expect(h.session.state, isA<Authenticated>());
  });
}
