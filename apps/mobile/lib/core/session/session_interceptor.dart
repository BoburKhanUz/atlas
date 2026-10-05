import 'package:dio/dio.dart';

import '../network/interceptors.dart';
import 'recovery.dart';
import 'session_controller.dart';

/// Keeps authenticated requests on a valid session:
/// * before a Bearer request: an expired access token is refreshed first
///   (single flight — N concurrent requests cause one refresh);
/// * a 401 on a Bearer request starts (or joins) a recovery episode, then
///   the request is re-sent once with the new token;
/// * when recovery ends the session, the request fails with
///   `SessionEndedFailure` and the app returns to sign-in.
///
/// Only operations the contract marks with `bearerAuth` are touched; login,
/// register, refresh and logout use a separate Dio.
class AtlasSessionInterceptor extends Interceptor {
  AtlasSessionInterceptor(this._session, this._dio);

  final SessionController _session;
  final Dio _dio;

  static const generationKey = 'atlas.sessionGeneration';

  /// The race-path probe (sent from inside an episode): never waits for, or
  /// starts, another episode.
  static const probeKey = 'atlas.authProbe';

  /// Already re-sent after a recovery: a second 401 is returned as is.
  static const retriedKey = 'atlas.authRetried';

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (!AtlasBearerInterceptor.requiresBearer(options)) return handler.next(options);
    if (options.extra[probeKey] != true) {
      final failure = await _session.ensureAccess();
      if (failure != null) {
        return handler.reject(DioException(requestOptions: options, type: DioExceptionType.unknown, error: failure));
      }
    }
    options.extra[generationKey] = _session.generation;
    options.cancelToken ??= _session.requestCancelToken;
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final o = err.requestOptions;
    if (err.response?.statusCode != 401 ||
        !AtlasBearerInterceptor.requiresBearer(o) ||
        o.extra[probeKey] == true ||
        o.extra[retriedKey] == true) {
      return handler.next(err);
    }
    final sent = (o.extra[generationKey] as int?) ?? -1;
    final result = await _session.recover(sentGeneration: sent, retryOriginal: () => _resend(o, probe: true));
    final Object outcome;
    switch (result) {
      case EpisodeRecovered(:final probe) when probe != null:
        outcome = probe;
      case EpisodeRecovered():
        outcome = await _resend(o, probe: false);
      default:
        outcome = DioException(
          requestOptions: o,
          response: err.response,
          type: DioExceptionType.badResponse,
          error: _session.failureFor(result),
        );
    }
    if (outcome is Response<dynamic>) return handler.resolve(outcome);
    handler.next(outcome as DioException);
  }

  /// Re-sends [original] once (the Bearer interceptor adds the current
  /// token). Returns the `Response` or the `DioException`.
  Future<Object> _resend(RequestOptions original, {required bool probe}) async {
    final data = original.data;
    final copy = original.copyWith(
      data: data is FormData ? data.clone() : data,
      extra: {...original.extra, probe ? probeKey : retriedKey: true},
      cancelToken: original.cancelToken,
    );
    try {
      return await _dio.fetch<dynamic>(copy);
    } on DioException catch (e) {
      return e;
    }
  }
}
