import 'dart:async';
import 'dart:math';

import 'package:atlas_api/atlas_api.dart' show AtlasApi;
import 'package:built_value/serializer.dart' show DeserializationError;
import 'package:dio/dio.dart';

import '../config/environment_config.dart';
import '../logging/app_log.dart';
import 'access_token_source.dart';
import 'api_failure.dart';
import 'connectivity.dart';
import 'error_mapper.dart';
import 'interceptors.dart';

/// Builds the one shared Dio instance for the ATLAS API. The order of the
/// interceptors matters: contract headers → bearer → logging →
/// reachability → retry.
Dio buildAtlasDio({
  required AtlasEnvironmentConfig config,
  required AccessTokenSource tokens,
  required ApiReachability reachability,
  HttpClientAdapter? adapter,
  Future<void> Function(Duration)? sleep,
  Duration Function()? monotonicNow,
  Random? random,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: config.apiBaseUrl.toString(),
      connectTimeout: config.timeouts.connect,
      receiveTimeout: config.timeouts.receive,
      sendTimeout: config.timeouts.send,
      headers: {'X-Atlas-Client': 'mobile'},
      // Error statuses become DioExceptions (mapped to ApiFailure).
      validateStatus: (status) => status != null && status >= 200 && status < 300,
      // Redirects could forward the Authorization header elsewhere.
      followRedirects: false,
      persistentConnection: true,
    ),
  );
  if (adapter != null) dio.httpClientAdapter = adapter;
  dio.interceptors.addAll([
    AtlasClientHeadersInterceptor(),
    AtlasBearerInterceptor(tokens),
    AtlasLoggingInterceptor(),
    AtlasReachabilityInterceptor(reachability),
    AtlasRetryInterceptor(dio: dio, policy: config.retry, sleep: sleep, monotonicNow: monotonicNow, random: random),
  ]);
  return dio;
}

/// The generated API ([AtlasApi]) behind one error contract: every call
/// returns data or throws exactly one [ApiFailure].
class AtlasApiClient {
  AtlasApiClient({required this.dio, required DeviceNetwork network})
    : _network = network, // ignore: prefer_initializing_formals
      // `interceptors: const []` — never add the generated auth interceptors:
      // its ApiKeyAuthInterceptor would send the token as an `atlas_at`
      // cookie (cookieAuth), which the mobile client must never do.
      api = AtlasApi(dio: dio, interceptors: const []);

  final Dio dio;
  final AtlasApi api;
  final DeviceNetwork _network;

  /// Runs one generated operation, e.g.
  /// `client.call((api) => api.getWardrobeApi().listWardrobeItems(limit: 20))`.
  Future<T> call<T extends Object>(Future<Response<T>> Function(AtlasApi api) operation) async {
    final Response<T> response;
    try {
      response = await operation(api);
    } on DioException catch (e, stack) {
      throw await _failureFor(e, stack);
    }
    final data = response.data;
    if (data == null) {
      throw UnexpectedResponseFailure(statusCode: response.statusCode, reason: 'empty body');
    }
    return data;
  }

  /// Same as [call] for operations whose success has no body we need.
  Future<void> callVoid(Future<Response<Object?>> Function(AtlasApi api) operation) async {
    try {
      await operation(api);
    } on DioException catch (e, stack) {
      throw await _failureFor(e, stack);
    }
  }

  Future<ApiFailure> _failureFor(DioException e, StackTrace stack) async {
    // A programming error (e.g. a credential in a query parameter) is not a
    // network problem: surface it as itself.
    final cause = e.error;
    if (cause is DeserializationError) {
      AppLog.warn('API response does not match the contract (${e.requestOptions.uri.path})');
      return UnexpectedResponseFailure(
        statusCode: e.response?.statusCode,
        reason: 'response does not match the contract',
      );
    }
    if (cause is Error) Error.throwWithStackTrace(cause, stack);
    final failure = ApiErrorMapper.fromDio(e, deviceHasNetwork: await _network.hasNetwork());
    AppLog.warn('API call failed: ${failure.describe()}');
    return failure;
  }
}
