import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';

import '../config/environment_config.dart';
import '../logging/app_log.dart';
import 'access_token_source.dart';
import 'api_error_code.dart';
import 'api_failure.dart';
import 'connectivity.dart';
import 'error_mapper.dart';

/// `extra` keys used by the HTTP layer.
abstract final class AtlasRequestExtra {
  /// Set by the generated client: the operation's security requirements.
  static const secure = 'secure';

  /// Opt-in: this non-GET request is idempotent (safe to repeat on network
  /// errors). Never set for multipart uploads — they are retried by the
  /// caller with the same Idempotency-Key instead.
  static const idempotent = 'atlas.idempotent';

  static const networkRetries = 'atlas.networkRetries';
  static const busyRetries = 'atlas.busyRetries';
  static const firstAttemptAtUs = 'atlas.firstAttemptAtUs';
}

/// Removes headers by lower-case name. (Dio's case-insensitive header map
/// does not support `removeWhere`; collect the keys first.)
void _removeHeaders(Map<String, dynamic> headers, Set<String> lowerCaseNames) {
  final doomed = headers.keys.where((k) => lowerCaseNames.contains(k.toLowerCase())).toList();
  doomed.forEach(headers.remove);
}

/// Contract headers on every request: `X-Atlas-Client: mobile` (always),
/// JSON accept, and never a Cookie (mobile authenticates with Bearer only).
/// Rejects credentials in query parameters — a programming error.
class AtlasClientHeadersInterceptor extends Interceptor {
  static final _credentialParam = RegExp(r'token|password|secret|authorization|session', caseSensitive: false);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final query = {...options.queryParameters.keys, ...options.uri.queryParameters.keys};
    final leaked = query.where(_credentialParam.hasMatch).toList();
    if (leaked.isNotEmpty) {
      handler.reject(
        DioException(
          requestOptions: options,
          type: DioExceptionType.unknown,
          error: StateError('credentials must never be sent as query parameters (${leaked.join(', ')})'),
        ),
      );
      return;
    }
    _removeHeaders(options.headers, const {'cookie', 'x-atlas-client'});
    options.headers['X-Atlas-Client'] = 'mobile';
    options.headers.putIfAbsent('Accept', () => 'application/json');
    handler.next(options);
  }
}

/// Adds `Authorization: Bearer <access>` to operations the contract marks
/// with `bearerAuth`, and removes any Authorization header everywhere else
/// (public endpoints such as login, refresh and signed media never see the
/// token). There is no cookie fallback.
class AtlasBearerInterceptor extends Interceptor {
  AtlasBearerInterceptor(this._tokens);
  final AccessTokenSource _tokens;

  static bool requiresBearer(RequestOptions options) {
    final secure = options.extra[AtlasRequestExtra.secure];
    return secure is List && secure.any((s) => s is Map && s['type'] == 'http' && s['scheme'] == 'bearer');
  }

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    _removeHeaders(options.headers, const {'authorization'});
    if (requiresBearer(options)) {
      final token = await _tokens.currentAccessToken();
      if (token != null && token.isNotEmpty) options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}

/// Any HTTP response (even an error status) proves the API is reachable; a
/// connection error or timeout proves it is not.
class AtlasReachabilityInterceptor extends Interceptor {
  AtlasReachabilityInterceptor(this._reachability);
  final ApiReachability _reachability;

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    _reachability.report(reachable: true);
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response != null) {
      _reachability.report(reachable: true);
    } else if (AtlasRetryInterceptor.isTransportFailure(err)) {
      _reachability.report(reachable: false);
    }
    handler.next(err);
  }
}

/// Bounded, safe automatic retries:
/// * timeouts / connection errors — only for safe requests (GET/HEAD/OPTIONS
///   or explicitly idempotent ones), after 1 s then 2 s, within 45 s of the
///   first attempt (RetryPolicy);
/// * 503 SESSION_BUSY — after Retry-After (+ jitter), at most 2 retries; the
///   contract guarantees SESSION_BUSY has no side effects, so this applies to
///   any method whose body can be replayed;
/// * never: multipart uploads (retried by the caller with the same
///   Idempotency-Key), other POST/PATCH/DELETE, 4xx/5xx other than
///   SESSION_BUSY.
class AtlasRetryInterceptor extends Interceptor {
  AtlasRetryInterceptor({
    required this.dio,
    required this.policy,
    Future<void> Function(Duration)? sleep,
    Duration Function()? monotonicNow,
    Random? random,
  }) : _sleep = sleep ?? Future<void>.delayed,
       _now = monotonicNow ?? _defaultClock(),
       _random = random ?? Random();

  final Dio dio;
  final RetryPolicy policy;
  final Future<void> Function(Duration) _sleep;
  final Duration Function() _now;
  final Random _random;

  static Duration Function() _defaultClock() {
    final watch = Stopwatch()..start();
    return () => watch.elapsed;
  }

  static const _safeMethods = {'GET', 'HEAD', 'OPTIONS'};

  static bool isTransportFailure(DioException e) =>
      e.response == null &&
      switch (e.type) {
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout ||
        DioExceptionType.connectionError => true,
        DioExceptionType.unknown => e.error is! Error,
        _ => false,
      };

  static bool _replayable(RequestOptions o) => o.data is! FormData && o.data is! Stream;

  static bool isSafeToRepeat(RequestOptions o) =>
      _replayable(o) &&
      (_safeMethods.contains(o.method.toUpperCase()) || o.extra[AtlasRequestExtra.idempotent] == true);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra.putIfAbsent(AtlasRequestExtra.firstAttemptAtUs, () => _now().inMicroseconds);
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final o = err.requestOptions;
    final wait = _retryDelay(err);
    if (wait == null) return handler.next(err);
    await _sleep(wait);
    try {
      handler.resolve(await dio.fetch<dynamic>(o));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// How long to wait before retrying [err], or null for "do not retry".
  /// Increments the attempt counters in the request's `extra`.
  Duration? _retryDelay(DioException err) {
    final o = err.requestOptions;

    if (err.response != null) {
      final failure = ApiErrorMapper.fromResponse(err.response);
      if (failure is! ApiHttpFailure || failure.code != ApiErrorCode.sessionBusy || !_replayable(o)) return null;
      final done = (o.extra[AtlasRequestExtra.busyRetries] as int?) ?? 0;
      if (done >= policy.busyMaxRetries) return null;
      final base = failure.retryAfter ?? const Duration(seconds: 1);
      if (base > policy.maxRetryAfter) return null;
      o.extra[AtlasRequestExtra.busyRetries] = done + 1;
      final jitterMs = policy.maxJitter.inMilliseconds;
      return base + Duration(milliseconds: jitterMs == 0 ? 0 : _random.nextInt(jitterMs + 1));
    }

    if (!isTransportFailure(err) || !isSafeToRepeat(o)) return null;
    final done = (o.extra[AtlasRequestExtra.networkRetries] as int?) ?? 0;
    if (done >= policy.networkRetryDelays.length) return null;
    final delay = policy.networkRetryDelays[done];
    final started = Duration(microseconds: (o.extra[AtlasRequestExtra.firstAttemptAtUs] as int?) ?? 0);
    if (_now() + delay - started > policy.networkRetryWindow) return null;
    o.extra[AtlasRequestExtra.networkRetries] = done + 1;
    return delay;
  }
}

/// Request/response log lines: method, path (never the query — it may hold
/// a media signature), status, timing, error code. Never headers or bodies.
class AtlasLoggingInterceptor extends Interceptor {
  static const _startKey = 'atlas.logStartUs';
  final _watch = Stopwatch()..start();

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra[_startKey] = _watch.elapsedMicroseconds;
    AppLog.debug('→ ${options.method} ${options.uri.path}');
    handler.next(options);
  }

  int _ms(RequestOptions o) =>
      ((_watch.elapsedMicroseconds - ((o.extra[_startKey] as int?) ?? _watch.elapsedMicroseconds)) / 1000).round();

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    final o = response.requestOptions;
    AppLog.info('← ${response.statusCode} ${o.method} ${o.uri.path} ${_ms(o)}ms');
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final o = err.requestOptions;
    final failure = ApiErrorMapper.fromDio(err, deviceHasNetwork: true);
    AppLog.warn('✗ ${o.method} ${o.uri.path} ${_ms(o)}ms ${failure.describe()}');
    handler.next(err);
  }
}
