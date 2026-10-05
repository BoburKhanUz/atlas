import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_error_code.dart';
import 'api_failure.dart';

/// The single place where transport errors become [ApiFailure]s.
abstract final class ApiErrorMapper {
  /// [deviceHasNetwork] distinguishes "no network at all" from "network is
  /// up but the API cannot be reached" for connection errors.
  static ApiFailure fromDio(DioException e, {required bool deviceHasNetwork}) {
    if (e.error is ApiFailure) return e.error! as ApiFailure;
    return switch (e.type) {
      DioExceptionType.connectionTimeout => const TimeoutFailure('connect'),
      DioExceptionType.sendTimeout => const TimeoutFailure('send'),
      DioExceptionType.receiveTimeout => const TimeoutFailure('receive'),
      DioExceptionType.transformTimeout => const TimeoutFailure('transform'),
      DioExceptionType.badCertificate => const InsecureConnectionFailure(),
      DioExceptionType.cancel => const CancelledFailure(),
      DioExceptionType.badResponse => fromResponse(e.response),
      DioExceptionType.connectionError ||
      DioExceptionType.unknown => _connectionFailure(e, deviceHasNetwork: deviceHasNetwork),
    };
  }

  static ApiFailure _connectionFailure(DioException e, {required bool deviceHasNetwork}) {
    final cause = e.error;
    if (cause is HandshakeException || cause is TlsException) return const InsecureConnectionFailure();
    final response = e.response;
    if (response != null && cause is! SocketException && cause is! HttpException) {
      // The server answered, but the generated client could not deserialize
      // a success body (or the error body) — the contract was not met.
      final status = response.statusCode ?? 0;
      return status >= 400
          ? fromResponse(response)
          : UnexpectedResponseFailure(statusCode: status, reason: 'response does not match the contract');
    }
    return deviceHasNetwork ? const ApiUnreachableFailure() : const NoNetworkFailure();
  }

  /// Maps an error response (status ≥ 400) using the documented
  /// `ErrorResponse` body `{ error, code, requestId?, details? }`.
  static ApiFailure fromResponse(Response<dynamic>? response) {
    if (response == null) return const UnexpectedResponseFailure(reason: 'no response');
    final status = response.statusCode ?? 0;
    final body = _decodeBody(response.data);
    final retryAfter = parseRetryAfter(response.headers.value('retry-after'));
    if (body == null || body['code'] is! String || body['error'] is! String) {
      return UnexpectedResponseFailure(statusCode: status, reason: 'body is not an ErrorResponse');
    }
    final rawCode = body['code']! as String;
    final details = body['details'];
    return ApiHttpFailure(
      statusCode: status,
      code: ApiErrorCode.fromWire(rawCode),
      rawCode: rawCode,
      serverMessage: body['error']! as String,
      requestId: body['requestId'] is String ? body['requestId']! as String : null,
      retryAfter: retryAfter,
      fieldErrors: [
        if (details is List)
          for (final d in details)
            if (d is Map && d['path'] is String && d['message'] is String)
              FieldError(d['path'] as String, d['message'] as String),
      ],
    );
  }

  static Map<String, Object?>? _decodeBody(Object? data) {
    try {
      final Object? decoded = switch (data) {
        final Map<String, Object?> m => m,
        final String s when s.trim().startsWith('{') => jsonDecode(s),
        final Uint8List b => jsonDecode(utf8.decode(b, allowMalformed: false)),
        final List<int> b => jsonDecode(utf8.decode(b, allowMalformed: false)),
        _ => null,
      };
      return decoded is Map<String, Object?> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  /// `Retry-After` as delta-seconds or HTTP-date (RFC 9110 §10.2.3).
  static Duration? parseRetryAfter(String? value, {DateTime? now}) {
    if (value == null) return null;
    final v = value.trim();
    final seconds = int.tryParse(v);
    if (seconds != null) return seconds >= 0 ? Duration(seconds: seconds) : null;
    try {
      final at = HttpDate.parse(v);
      final diff = at.difference(now ?? DateTime.now().toUtc());
      return diff.isNegative ? Duration.zero : diff;
    } on FormatException {
      return null;
    } on HttpException {
      return null;
    }
  }
}
