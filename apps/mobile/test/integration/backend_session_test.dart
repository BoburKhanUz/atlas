// Real-backend integration: the mobile session stack against a running
// ATLAS backend (apps/web). Skipped unless ATLAS_IT_BASE_URL is set.
//
// Run against a local, disposable backend only (never staging/production):
//   ACCESS_TOKEN_TTL_SECONDS=10 next dev -p 3100   (disposable itest_* database)
//   ATLAS_IT_BASE_URL=http://127.0.0.1:3100 \
//   ATLAS_IT_PSQL="psql -h /path/to/socket -p 55433 -U atlas -d itest_mobile33" \
//   flutter test test/integration/backend_session_test.dart
// ATLAS_IT_PSQL (optional) enables the SESSION_EXPIRED case, which moves a
// session family's absolute expiry into the past in that test database.
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart' show MeResponse;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/network/connectivity.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/session_controller.dart';
import 'package:atlas_mobile/core/session/session_interceptor.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/core/session/token_store.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_session.dart' show MemorySecureStore;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
final _psql = Platform.environment['ATLAS_IT_PSQL'];
final _skip = _base == null ? 'set ATLAS_IT_BASE_URL to run against a local backend' : null;

/// Counts requests per path on the real HTTP adapter.
class CountingAdapter implements HttpClientAdapter {
  final _inner = IOHttpClientAdapter();
  final counts = <String, int>{};

  /// Authorization header (or null) of every request, by path.
  final authorization = <String, List<Object?>>{};
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) {
    counts[o.uri.path] = (counts[o.uri.path] ?? 0) + 1;
    final auth = o.headers.entries.where((e) => e.key.toLowerCase() == 'authorization').map((e) => e.value).firstOrNull;
    (authorization[o.uri.path] ??= []).add(auth);
    return _inner.fetch(o, body, cancel);
  }

  @override
  void close({bool force = false}) => _inner.close(force: force);
}

class Device {
  Device({MemorySecureStore? kv}) : kv = kv ?? MemorySecureStore() {
    final config = AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: _base!);
    final reachability = ApiReachability();
    session = SessionController(
      config: config,
      store: TokenStore(this.kv),
      network: FakeNetwork(),
      reachability: reachability,
      adapter: authAdapter,
      deviceName: 'IT device',
    );
    final dio = buildAtlasDio(
      config: config,
      tokens: session,
      reachability: reachability,
      adapter: apiAdapter,
      session: (dio) => AtlasSessionInterceptor(session, dio),
    );
    client = AtlasApiClient(dio: dio, network: FakeNetwork());
  }

  final MemorySecureStore kv;
  final authAdapter = CountingAdapter();
  final apiAdapter = CountingAdapter();
  late final SessionController session;
  late final AtlasApiClient client;

  int get refreshCalls => authAdapter.counts['/api/v1/auth/refresh'] ?? 0;
  SessionTokens? get stored => kv.stored;

  Future<Object> me() async {
    try {
      return await client.call((api) => api.getAuthApi().getMe());
    } on Object catch (e) {
      return e;
    }
  }
}

/// A raw request outside the app stack (to play "another device" / an
/// attacker presenting an old token).
Future<(int, Map<String, Object?>)> rawPost(String path, Object body, {bool mobile = true}) async {
  final client = HttpClient();
  try {
    final req = await client.postUrl(Uri.parse('$_base$path'));
    req.headers.contentType = ContentType.json;
    if (mobile) req.headers.set('X-Atlas-Client', 'mobile');
    req.write(jsonEncode(body));
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    return (res.statusCode, text.isEmpty ? <String, Object?>{} : jsonDecode(text) as Map<String, Object?>);
  } finally {
    client.close();
  }
}

String _email() => 'mobile-it-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 20)}@test.local';
const _password = 'it-password-123';

Future<Device> registered() async {
  final d = Device();
  await d.session.restore();
  await d.session.register(email: _email(), password: _password, name: 'IT');
  return d;
}

Future<void> waitForAccessExpiry() => Future<void>.delayed(const Duration(seconds: 11));

void main() {
  group('real backend', skip: _skip, () {
    test('register → mobile session stored securely → authenticated /me', () async {
      final d = await registered();
      expect(d.session.state, isA<Authenticated>());
      final s = d.stored!;
      expect(s.accessToken, isNotEmpty);
      expect(s.refreshToken, isNotEmpty);
      // 90-day absolute limit from the server.
      final days = s.sessionExpiresAt.difference(DateTime.now().toUtc()).inDays;
      expect(days, inInclusiveRange(89, 90));
      expect(await d.me(), isA<MeResponse>());
    });

    test('login → /me; wrong password is UNAUTHORIZED and stores nothing', () async {
      final email = _email();
      final a = Device();
      await a.session.restore();
      await a.session.register(email: email, password: _password);
      final b = Device();
      await b.session.restore();
      await expectLater(b.session.login(email: email, password: 'wrong-password'), throwsA(isA<ApiHttpFailure>()));
      expect(b.kv.values, isEmpty);
      await b.session.login(email: email, password: _password);
      expect(b.session.state, isA<Authenticated>());
      final me = await b.me();
      expect(me, isA<MeResponse>());
      expect((me as MeResponse).user.email, email);
    });

    test('access expiry → one refresh → rotated pair stored; the 90-day limit does not move', () async {
      final d = await registered();
      final before = d.stored!;
      await waitForAccessExpiry();
      expect(await d.me(), isA<MeResponse>());
      expect(d.refreshCalls, 1);
      final after = d.stored!;
      expect(after.refreshToken, isNot(before.refreshToken), reason: 'rotation');
      expect(after.accessToken, isNot(before.accessToken));
      expect(after.sessionExpiresAt, before.sessionExpiresAt, reason: 'rotation never extends the family');
    });

    test('5 concurrent requests with an expired access token → exactly one refresh', () async {
      final d = await registered();
      await waitForAccessExpiry();
      final results = await Future.wait([for (var i = 0; i < 5; i++) d.me()]);
      expect(results, everyElement(isA<MeResponse>()));
      expect(d.refreshCalls, 1);
    });

    test('server-side 401 (access expired but locally believed valid) → refresh → retry', () async {
      final d = await registered();
      // Pretend the access token is valid for an hour (as if the device clock were wrong).
      final s = d.stored!;
      final kv = MemorySecureStore()
        ..put(
          SessionTokens(
            user: s.user,
            accessToken: s.accessToken,
            accessTokenExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
            refreshToken: s.refreshToken,
            refreshTokenExpiresAt: s.refreshTokenExpiresAt,
            sessionExpiresAt: s.sessionExpiresAt,
          ),
        );
      final e = Device(kv: kv);
      await e.session.restore();
      await waitForAccessExpiry();
      expect(await e.me(), isA<MeResponse>());
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['/api/v1/auth/me'], 2, reason: '401, then the retry');
    });

    test('lost refresh response: the same token again within 60 s is a grace replay (no logout)', () async {
      final d = await registered();
      final r1 = d.stored!.refreshToken;
      // The server rotates, but the app never sees the answer.
      final (status, body) = await rawPost('/api/v1/auth/refresh', {'refreshToken': r1});
      expect(status, 200);
      await waitForAccessExpiry();
      expect(await d.me(), isA<MeResponse>());
      expect(d.stored!.refreshToken, body['refreshToken'], reason: 'the same successor is replayed');
      expect(d.session.state, isA<Authenticated>());
    });

    test('logout: server revokes the family; nothing is sent with the old token afterwards', () async {
      final d = await registered();
      final old = d.stored!;
      await d.session.logout();
      expect(d.session.state, const Unauthenticated(SignedOutReason.loggedOut));
      expect(d.kv.values, isEmpty);
      final before = d.apiAdapter.counts['/api/v1/auth/me'] ?? 0;
      expect(await d.me(), isA<SessionEndedFailure>());
      expect(d.apiAdapter.counts['/api/v1/auth/me'] ?? 0, before);
      final (status, body) = await rawPost('/api/v1/auth/refresh', {'refreshToken': old.refreshToken});
      expect((status, body['code']), (401, 'SESSION_REVOKED'));
    });

    test('SESSION_REVOKED (signed out on another device) → tokens cleared, sign-in', () async {
      final d = await registered();
      final other = Device(kv: MemorySecureStore()..put(d.stored!));
      await other.session.restore();
      await other.session.logout();
      await waitForAccessExpiry();
      final result = await d.me();
      expect(result, isA<SessionEndedFailure>().having((f) => f.reason, 'reason', SignedOutReason.revoked));
      expect(d.session.state, const SessionExpired(SignedOutReason.revoked));
      expect(d.kv.values, isEmpty);
    });

    test('INVALID_TOKEN → tokens cleared, sign-in', () async {
      final d = await registered();
      final s = d.stored!;
      final bogus = MemorySecureStore()
        ..put(
          SessionTokens(
            user: s.user,
            accessToken: s.accessToken,
            accessTokenExpiresAt: DateTime.now().toUtc(),
            refreshToken: ['not', 'a', 'real', 'refresh'].join('-'),
            refreshTokenExpiresAt: s.refreshTokenExpiresAt,
            sessionExpiresAt: s.sessionExpiresAt,
          ),
        );
      final e = Device(kv: bogus);
      await e.session.restore();
      expect(e.session.state, const SessionExpired(SignedOutReason.revoked));
      expect(e.kv.values, isEmpty);
    });

    test('CLIENT_MISMATCH: a web session token presented in mobile mode → sign-in', () async {
      final email = _email();
      final a = Device();
      await a.session.restore();
      await a.session.register(email: email, password: _password);
      // Web login: the refresh token arrives as an HttpOnly cookie.
      final client = HttpClient();
      final req = await client.postUrl(Uri.parse('$_base/api/v1/auth/login'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'email': email, 'password': _password}));
      final res = await req.close();
      await res.drain<void>();
      client.close();
      final webRefresh = res.cookies.firstWhere((c) => c.name == 'atlas_rt').value;
      final s = a.stored!;
      final kv = MemorySecureStore()
        ..put(
          SessionTokens(
            user: s.user,
            accessToken: s.accessToken,
            accessTokenExpiresAt: DateTime.now().toUtc(),
            refreshToken: webRefresh,
            refreshTokenExpiresAt: s.refreshTokenExpiresAt,
            sessionExpiresAt: s.sessionExpiresAt,
          ),
        );
      final e = Device(kv: kv);
      await e.session.restore();
      expect(e.session.state, const SessionExpired(SignedOutReason.clientMismatch));
      expect(e.kv.values, isEmpty);
    });

    test('REFRESH_REUSED: an old token presented after the 60 s grace window → family revoked, sign-in', () async {
      final d = await registered();
      final r1 = d.stored!.refreshToken;
      await waitForAccessExpiry();
      expect(await d.me(), isA<MeResponse>()); // rotates r1 → r2
      await Future<void>.delayed(const Duration(seconds: 61));
      // An attacker (or a restored backup) presents r1.
      final (status, body) = await rawPost('/api/v1/auth/refresh', {'refreshToken': r1});
      expect((status, body['code']), (401, 'REFRESH_REUSED'));
      // The legitimate device finds its family revoked at its next refresh.
      final result = await d.me();
      expect(result, isA<SessionEndedFailure>());
      expect(d.session.state, isA<SessionExpired>());
      expect(d.kv.values, isEmpty);
      expect(d.refreshCalls, 2, reason: 'one terminal answer, no retry');
    }, timeout: const Timeout(Duration(minutes: 3)));

    test('SESSION_EXPIRED: the family passed its absolute limit (set in the test database) → sign-in', () async {
      final d = await registered();
      final parts = _psql!.split(' ');
      final dbIndex = parts.indexOf('-d');
      expect(parts[dbIndex + 1], startsWith('itest_'), reason: 'only a disposable test database');
      final user = d.stored!.user.id;
      final run = await Process.run(parts.first, [
        ...parts.skip(1),
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'UPDATE "SessionFamily" SET "absoluteExpiresAt" = atlas_now() - interval \'1 second\' WHERE "userId" = \'$user\'',
      ]);
      expect(run.exitCode, 0, reason: '${run.stderr}');
      await waitForAccessExpiry();
      final result = await d.me();
      expect(result, isA<SessionEndedFailure>().having((f) => f.reason, 'reason', SignedOutReason.expired));
      expect(d.kv.values, isEmpty);
    }, skip: _psql == null ? 'set ATLAS_IT_PSQL to run' : null);
  });
}
