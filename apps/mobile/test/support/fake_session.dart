import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/connectivity.dart';
import 'package:atlas_mobile/core/session/session_controller.dart';
import 'package:atlas_mobile/core/session/session_interceptor.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/core/session/token_store.dart';
import 'package:dio/dio.dart';

import 'fake_http.dart';

/// Test tokens, assembled at runtime (no realistic token literals in the
/// sources). Each is unique and easy to grep for in captured logs.
String testToken(String kind, int n) => ['tst', kind, 'value', '$n'].join('-');
String access(int n) => testToken('acc', n);
String refresh(int n) => testToken('ref', n);

final t0 = DateTime.utc(2026, 10, 5, 10);

Map<String, Object?> sessionUserJson() => {'id': 'u1', 'email': 'a@test.local', 'name': null};

/// A mobile auth body (login / register / refresh) for pair [n].
Map<String, Object?> pairJson(
  int n, {
  DateTime? issuedAt,
  Duration accessTtl = const Duration(minutes: 15),
  Duration refreshTtl = const Duration(days: 30),
  DateTime? sessionExpiresAt,
}) {
  final at = issuedAt ?? t0;
  return {
    'user': sessionUserJson(),
    'accessToken': access(n),
    'accessTokenExpiresAt': at.add(accessTtl).toIso8601String(),
    'refreshToken': refresh(n),
    'refreshTokenExpiresAt': at.add(refreshTtl).toIso8601String(),
    'sessionExpiresAt': (sessionExpiresAt ?? t0.add(const Duration(days: 90))).toIso8601String(),
  };
}

SessionTokens pair(
  int n, {
  DateTime? issuedAt,
  Duration accessTtl = const Duration(minutes: 15),
  Duration refreshTtl = const Duration(days: 30),
  DateTime? sessionExpiresAt,
}) {
  final at = issuedAt ?? t0;
  return SessionTokens(
    user: const SessionUser(id: 'u1', email: 'a@test.local'),
    accessToken: access(n),
    accessTokenExpiresAt: at.add(accessTtl),
    refreshToken: refresh(n),
    refreshTokenExpiresAt: at.add(refreshTtl),
    sessionExpiresAt: sessionExpiresAt ?? t0.add(const Duration(days: 90)),
  );
}

/// A pair that is valid right now on the real clock (widget tests that use
/// the production providers).
SessionTokens livePair(int n) {
  final now = DateTime.now().toUtc();
  return pair(n, issuedAt: now, sessionExpiresAt: now.add(const Duration(days: 90)));
}

/// In-memory stand-in for the Keystore/Keychain with switchable failures.
class MemorySecureStore implements SecureKeyValueStore {
  final values = <String, String>{};
  final ops = <String>[];
  bool failReads = false;
  bool failWrites = false;
  bool failDeletes = false;

  /// Simulates a platform that "succeeds" but stores nothing.
  bool dropWrites = false;

  @override
  Future<String?> read(String key) async {
    ops.add('read');
    if (failReads) throw StateError('keystore unavailable');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    ops.add('write');
    if (failWrites) throw StateError('keystore unavailable');
    if (!dropWrites) values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    ops.add('delete');
    if (failDeletes) throw StateError('keystore unavailable');
    values.remove(key);
  }

  SessionTokens? get stored {
    final raw = values[TokenStore.key];
    return raw == null ? null : SessionTokens.decode(raw);
  }

  void put(SessionTokens tokens) => values[TokenStore.key] = tokens.encode();
}

/// A server reply that can be held back until the test releases it.
class Gate {
  final _completer = Completer<void>();
  void open() => _completer.complete();
  Future<void> get future => _completer.future;
}

/// A fake backend routed by path. Each path has a reply script (one reply
/// per call, the last one repeats) or a handler.
class FakeBackend implements HttpClientAdapter {
  final sent = <SentRequest>[];
  final scripts = <String, List<FakeReply>>{};
  final handlers = <String, FutureOr<FakeReply> Function(SentRequest request)>{};
  final _calls = <String, int>{};

  /// Held replies for a path (completed by the test).
  final gates = <String, Gate>{};

  /// Runs before a reply for a path is returned (e.g. "another isolate
  /// stored a newer pair while this refresh was in flight").
  final sideEffects = <String, void Function(int call)>{};

  /// Sets the reply script of [path] (restarting at its first reply).
  void script(String path, List<FakeReply> replies) {
    scripts[path] = replies;
    _calls[path] = 0;
  }

  List<SentRequest> to(String path) => sent.where((r) => r.uri.path == path).toList();
  int calls(String path) => to(path).length;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = <int>[];
    if (requestStream != null) {
      await for (final chunk in requestStream) {
        bytes.addAll(chunk);
      }
    }
    final request = SentRequest(options, Uint8List.fromList(bytes));
    sent.add(request);
    final path = options.uri.path;
    final call = _calls[path] = (_calls[path] ?? 0) + 1;
    final gate = gates[path];
    if (gate != null) {
      if (cancelFuture != null) {
        await Future.any([gate.future, cancelFuture]);
      } else {
        await gate.future;
      }
    }
    sideEffects[path]?.call(call);
    final FakeReply reply;
    final handler = handlers[path];
    if (handler != null) {
      reply = await handler(request);
    } else {
      final list = scripts[path];
      if (list == null || list.isEmpty) throw StateError('no reply scripted for $path');
      reply = list[(call - 1).clamp(0, list.length - 1)];
    }
    switch (reply) {
      case TransportFailure(:final type, :final error):
        throw DioException(requestOptions: options, type: type, error: error);
      case JsonReply(:final status, :final body, :final headers):
        return ResponseBody.fromString(
          body == null ? '' : jsonEncode(body),
          status,
          headers: {
            Headers.contentTypeHeader: ['application/json; charset=utf-8'],
            for (final h in headers.entries) h.key.toLowerCase(): [h.value],
          },
        );
      case RawReply(:final status, :final text, :final contentType):
        return ResponseBody.fromString(
          text,
          status,
          headers: {
            Headers.contentTypeHeader: [contentType],
          },
        );
    }
  }

  @override
  void close({bool force = false}) {}
}

/// Paths of the contract.
abstract final class P {
  static const login = '/api/v1/auth/login';
  static const register = '/api/v1/auth/register';
  static const refresh = '/api/v1/auth/refresh';
  static const logout = '/api/v1/auth/logout';
  static const me = '/api/v1/auth/me';
  static const wardrobe = '/api/v1/wardrobe/items';
}

Map<String, Object?> meJson() => {
  'user': {'id': 'u1', 'email': 'a@test.local', 'name': null, 'createdAt': '2026-10-01T00:00:00.000Z'},
};

/// The real session stack (controller + interceptors + generated client)
/// against [FakeBackend], with fake time.
class SessionHarness {
  SessionHarness({SessionTokens? stored, bool online = true, this.startupWait = const Duration(seconds: 8)})
    : network = FakeNetwork(online: online) {
    if (stored != null) kv.put(stored);
    store = TokenStore(kv);
    final config = AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: 'http://api.test');
    session = SessionController(
      config: config,
      store: store,
      network: network,
      reachability: reachability,
      adapter: backend,
      sleep: _sleep,
      monotonicNow: () => now,
      clock: () => wall,
      random: Random(7),
      deviceName: 'Test device',
      startupWait: startupWait,
    );
    dio = buildAtlasDio(
      config: config,
      tokens: session,
      reachability: reachability,
      adapter: backend,
      sleep: _sleep,
      monotonicNow: () => now,
      session: (dio) => AtlasSessionInterceptor(session, dio),
    );
    client = AtlasApiClient(dio: dio, network: network);
  }

  final backend = FakeBackend();
  final kv = MemorySecureStore();
  final reachability = ApiReachability();
  final FakeNetwork network;
  final Duration startupWait;
  late final TokenStore store;
  late final SessionController session;
  late final Dio dio;
  late final AtlasApiClient client;

  Duration now = Duration.zero;
  DateTime wall = t0;
  final sleeps = <Duration>[];

  Future<void> _sleep(Duration d) async {
    sleeps.add(d);
    now += d;
    wall = wall.add(d);
  }

  /// Moves both clocks forward.
  void advance(Duration d) {
    now += d;
    wall = wall.add(d);
  }

  Future<Object> getMe() => client.call((api) => api.getAuthApi().getMe());

  /// Runs [getMe] and returns the result or the thrown failure.
  Future<Object> tryMe() async {
    try {
      return await getMe();
    } on Object catch (e) {
      return e;
    }
  }

  /// Bearer values the backend saw on a path, in order.
  List<Object?> bearers(String path) => backend.to(path).map((r) => r.header('Authorization')).toList();

  /// `refreshToken` values presented to POST /auth/refresh, in order.
  List<String?> presentedRefreshTokens() => backend
      .to(P.refresh)
      .map((r) => (jsonDecode(r.bodyText) as Map<String, Object?>)['refreshToken'] as String?)
      .toList();
}
