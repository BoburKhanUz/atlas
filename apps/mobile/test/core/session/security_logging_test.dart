// The authentication layer never logs credentials. Every flow below runs
// with verbose logging captured; the captured text must contain none of
// the secrets that flowed through it.
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  final lines = <String>[];
  late void Function(String) originalSink;
  late LogPolicy originalPolicy;

  setUp(() {
    lines.clear();
    originalSink = AppLog.sink;
    originalPolicy = AppLog.policy;
    AppLog.sink = lines.add;
    AppLog.policy = LogPolicy.verbose;
  });
  tearDown(() {
    AppLog.sink = originalSink;
    AppLog.policy = originalPolicy;
  });

  // Assembled at runtime; never realistic literals.
  final password = ['pw', 'Sekret', '9431'].join('-');
  final mediaSig = ['sig', 'abc', 'def'].join('');

  List<String> secrets() => [
    for (var n = 1; n <= 60; n++) ...[access(n), refresh(n)],
    password,
    mediaSig,
    'atlas_at=',
    'atlas_rt=',
  ];

  void expectNoSecrets() {
    final text = lines.join('\n');
    expect(lines, isNotEmpty, reason: 'logging was active during the flow');
    for (final s in secrets()) {
      expect(text, isNot(contains(s)), reason: 'log must not contain "$s"');
    }
    expect(text.toLowerCase(), isNot(contains('authorization')));
    expect(text.toLowerCase(), isNot(contains('bearer ')));
    expect(text.toLowerCase(), isNot(contains('cookie')));
    expect(text, isNot(contains('a@test.local')), reason: 'login e-mail is not logged either');
  }

  test('login, authenticated request, 401 → refresh → retry, logout: nothing secret logged', () async {
    final h = SessionHarness();
    await h.session.restore();
    h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
    await h.session.login(email: 'a@test.local', password: password);
    h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
    h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
    await h.getMe();
    h.backend.script(P.logout, [
      JsonReply(200, {'ok': true}),
    ]);
    await h.session.logout();
    expectNoSecrets();
  });

  test('failed login (wrong password) and validation errors: password never logged', () async {
    final h = SessionHarness();
    await h.session.restore();
    h.backend.script(P.login, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
    await expectLater(h.session.login(email: 'a@test.local', password: password), throwsA(isA<ApiFailure>()));
    expectNoSecrets();
  });

  test('every recovery path (race, busy, timeout, terminal) logs no token', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.backend.script(P.refresh, [
      JsonReply(401, errorBody('SESSION_RACE')),
      JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
      TransportFailure(DioExceptionType.receiveTimeout),
    ]);
    h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
    await h.tryMe();
    h.advance(const Duration(minutes: 1));
    h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
    await h.tryMe();
    expectNoSecrets();
  });

  test('storage failures log no token', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.kv.failWrites = true;
    h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
    h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
    await h.tryMe();
    h.backend.script(P.login, [JsonReply(200, pairJson(3))]);
    expectNoSecrets();
  });

  test('a signed media URL in a request path query is never logged in full', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.backend.script('/api/v1/media/users/u1/a.webp', [RawReply(200, 'x', contentType: 'image/webp')]);
    try {
      await h.dio.get<Object?>('/api/v1/media/users/u1/a.webp?exp=1&sig=$mediaSig');
    } on Object {
      // only the log matters here
    }
    expectNoSecrets();
  });

  test('state, failures and token objects print no secrets', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    final printed = [
      h.session.state.toString(),
      pair(1).toString(),
      const SessionEndedFailure(SignedOutReason.reused).toString(),
      const SecureStorageFailure('write').toString(),
    ].join(' ');
    for (final s in secrets()) {
      expect(printed, isNot(contains(s)));
    }
  });
}
