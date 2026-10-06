import 'dart:io';

import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/network/error_mapper.dart';
import 'package:atlas_mobile/core/network/user_messages.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';

/// (code, status the backend uses, kind, retryable)
const _contract = <(String, int, ApiErrorKind, bool)>[
  ('BAD_REQUEST', 400, ApiErrorKind.invalidRequest, false),
  ('VALIDATION_ERROR', 400, ApiErrorKind.invalidRequest, false),
  ('UNAUTHORIZED', 401, ApiErrorKind.unauthorized, false),
  ('FORBIDDEN', 403, ApiErrorKind.forbidden, false),
  ('NOT_FOUND', 404, ApiErrorKind.notFound, false),
  ('CONFLICT', 409, ApiErrorKind.conflict, false),
  ('PAYLOAD_TOO_LARGE', 413, ApiErrorKind.invalidImage, false),
  ('UNSUPPORTED_MEDIA_TYPE', 415, ApiErrorKind.invalidImage, false),
  ('INVALID_IMAGE', 422, ApiErrorKind.invalidImage, false),
  ('UNSUPPORTED_IMAGE_FORMAT', 415, ApiErrorKind.invalidImage, false),
  ('IMAGE_DIMENSIONS', 422, ApiErrorKind.invalidImage, false),
  ('IDEMPOTENCY_KEY_MISMATCH', 409, ApiErrorKind.idempotencyMismatch, false),
  ('IDEMPOTENCY_IN_PROGRESS', 409, ApiErrorKind.inProgress, true),
  ('RATE_LIMITED', 429, ApiErrorKind.rateLimited, true),
  ('INTERNAL', 500, ApiErrorKind.server, true),
  ('INVALID_TOKEN', 401, ApiErrorKind.sessionTerminal, false),
  ('SESSION_EXPIRED', 401, ApiErrorKind.sessionTerminal, false),
  ('SESSION_REVOKED', 401, ApiErrorKind.sessionTerminal, false),
  ('REFRESH_REUSED', 401, ApiErrorKind.sessionTerminal, false),
  ('SESSION_RACE', 401, ApiErrorKind.sessionRace, true),
  ('CLIENT_MISMATCH', 401, ApiErrorKind.sessionTerminal, false),
  ('SESSION_BUSY', 503, ApiErrorKind.sessionBusy, true),
  ('NOT_A_GARMENT', 422, ApiErrorKind.invalidImage, false),
  ('AI_QUOTA_EXCEEDED', 429, ApiErrorKind.rateLimited, true),
  ('AI_UNAVAILABLE', 503, ApiErrorKind.server, true),
];

Response<dynamic> _resp(int status, Object? data, {Map<String, List<String>> headers = const {}}) => Response<dynamic>(
  requestOptions: RequestOptions(path: '/x'),
  statusCode: status,
  data: data,
  headers: Headers.fromMap(headers),
);

void main() {
  test('the mapper knows exactly the 25 contract codes', () {
    expect(
      ApiErrorCode.values.where((c) => c != ApiErrorCode.unknown).map((c) => c.wire).toSet(),
      _contract.map((c) => c.$1).toSet(),
    );
  });

  group('every backend error code', () {
    for (final (code, status, kind, retryable) in _contract) {
      test('$code → $kind, retryable=$retryable, status/code/message/requestId preserved', () {
        final f = ApiErrorMapper.fromResponse(
          _resp(status, errorBody(code, error: 'Backend matni', requestId: 'r-$code')),
        );
        expect(f, isA<ApiHttpFailure>());
        f as ApiHttpFailure;
        expect(f.statusCode, status);
        expect(f.code.wire, code);
        expect(f.rawCode, code);
        expect(f.kind, kind);
        expect(f.retryable, retryable);
        expect(f.serverMessage, 'Backend matni');
        expect(f.requestId, 'r-$code');
        expect(f.userMessage, isNotEmpty);
        expect(f.userMessage, isNot(contains('Exception')));
      });
    }
  });

  test('terminal session codes are exactly the recovery-vector terminalCodes', () {
    expect(ApiErrorCode.values.where((c) => c.isTerminalSession).map((c) => c.wire).toSet(), {
      'INVALID_TOKEN',
      'SESSION_EXPIRED',
      'SESSION_REVOKED',
      'REFRESH_REUSED',
      'CLIENT_MISMATCH',
    });
  });

  group('Retry-After', () {
    test('delta-seconds on SESSION_BUSY', () {
      final f = ApiErrorMapper.fromResponse(
        _resp(
          503,
          errorBody('SESSION_BUSY'),
          headers: {
            'retry-after': ['1'],
          },
        ),
      ) as ApiHttpFailure;
      expect(f.retryAfter, const Duration(seconds: 1));
    });

    test('on IDEMPOTENCY_IN_PROGRESS', () {
      final f = ApiErrorMapper.fromResponse(
        _resp(
          409,
          errorBody('IDEMPOTENCY_IN_PROGRESS'),
          headers: {
            'retry-after': ['3'],
          },
        ),
      );
      expect(f.retryAfter, const Duration(seconds: 3));
    });

    test('HTTP-date form', () {
      final now = DateTime.utc(2026, 10, 5, 10);
      final date = HttpDate.format(now.add(const Duration(seconds: 30)));
      expect(ApiErrorMapper.parseRetryAfter(date, now: now), const Duration(seconds: 30));
      expect(
        ApiErrorMapper.parseRetryAfter(HttpDate.format(now.subtract(const Duration(minutes: 1))), now: now),
        Duration.zero,
      );
    });

    test('absent, negative or garbage → null', () {
      expect(ApiErrorMapper.parseRetryAfter(null), isNull);
      expect(ApiErrorMapper.parseRetryAfter('-5'), isNull);
      expect(ApiErrorMapper.parseRetryAfter('soon'), isNull);
    });
  });

  test('VALIDATION_ERROR details become field errors; the backend message is shown', () {
    final f = ApiErrorMapper.fromResponse(
      _resp(
        400,
        errorBody(
          'VALIDATION_ERROR',
          error: 'Parol kamida 8 belgi bo‘lishi kerak',
          details: [
            {'path': 'password', 'message': 'too short'},
            {'path': 7, 'message': 'ignored: path must be a string'},
          ],
        ),
      ),
    ) as ApiHttpFailure;
    expect(f.fieldErrors, [const FieldError('password', 'too short')]);
    expect(f.userMessage, 'Parol kamida 8 belgi bo‘lishi kerak');
  });

  test('technical backend text is never shown to users', () {
    final f = ApiErrorMapper.fromResponse(
      _resp(409, errorBody('CONFLICT', error: 'PrismaClientKnownRequestError: Unique constraint at User.email')),
    );
    expect(f.userMessage, UserMessages.generic);
  });

  test('image errors get specific guidance', () {
    String msg(String code) => ApiErrorMapper.fromResponse(_resp(422, errorBody(code))).userMessage;
    expect(msg('UNSUPPORTED_IMAGE_FORMAT'), contains('JPEG, PNG yoki WebP'));
    expect(msg('IMAGE_DIMENSIONS'), contains('256 px'));
    expect(msg('PAYLOAD_TOO_LARGE'), contains('8 MB'));
  });

  test('an unknown future code keeps the raw code and is not retryable unless 5xx', () {
    final f4 = ApiErrorMapper.fromResponse(_resp(418, errorBody('TEAPOT'))) as ApiHttpFailure;
    expect(f4.code, ApiErrorCode.unknown);
    expect(f4.rawCode, 'TEAPOT');
    expect(f4.retryable, isFalse);
    final f5 = ApiErrorMapper.fromResponse(_resp(502, errorBody('UPSTREAM'))) as ApiHttpFailure;
    expect(f5.retryable, isTrue);
  });

  group('responses that are not the contract', () {
    test('HTML from a proxy', () {
      final f = ApiErrorMapper.fromResponse(_resp(502, '<html>Bad gateway</html>'));
      expect(f, isA<UnexpectedResponseFailure>());
      expect(f.retryable, isTrue);
      expect(f.userMessage, UserMessages.unexpected);
    });

    test('JSON without code/error', () {
      expect(ApiErrorMapper.fromResponse(_resp(400, {'message': 'x'})), isA<UnexpectedResponseFailure>());
    });

    test('JSON error body delivered as a string or bytes', () {
      expect(
        ApiErrorMapper.fromResponse(_resp(404, '{"error":"Topilmadi","code":"NOT_FOUND"}')),
        isA<ApiHttpFailure>(),
      );
    });
  });

  group('transport errors', () {
    DioException ex(DioExceptionType t, [Object? error]) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      type: t,
      error: error,
    );

    test('timeouts', () {
      for (final t in [
        DioExceptionType.connectionTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
      ]) {
        final f = ApiErrorMapper.fromDio(ex(t), deviceHasNetwork: true);
        expect(f, isA<TimeoutFailure>(), reason: '$t');
        expect(f.retryable, isTrue);
      }
    });

    test('connection error with the device offline → NoNetworkFailure', () {
      expect(
        ApiErrorMapper.fromDio(
          ex(DioExceptionType.connectionError, const SocketException('x')),
          deviceHasNetwork: false,
        ),
        isA<NoNetworkFailure>(),
      );
    });

    test('connection error with the device online → ApiUnreachableFailure', () {
      expect(
        ApiErrorMapper.fromDio(
          ex(DioExceptionType.connectionError, const SocketException('refused')),
          deviceHasNetwork: true,
        ),
        isA<ApiUnreachableFailure>(),
      );
    });

    test('bad certificate / TLS handshake → insecure, never retryable', () {
      expect(
        ApiErrorMapper.fromDio(ex(DioExceptionType.badCertificate), deviceHasNetwork: true),
        isA<InsecureConnectionFailure>(),
      );
      final tls = ApiErrorMapper.fromDio(
        ex(DioExceptionType.connectionError, const HandshakeException('x')),
        deviceHasNetwork: true,
      );
      expect(tls, isA<InsecureConnectionFailure>());
      expect(tls.retryable, isFalse);
    });

    test('cancel → CancelledFailure', () {
      expect(ApiErrorMapper.fromDio(ex(DioExceptionType.cancel), deviceHasNetwork: true), isA<CancelledFailure>());
    });

    test('user messages never leak exception text', () {
      final f = ApiErrorMapper.fromDio(
        ex(DioExceptionType.connectionError, const SocketException('Failed host lookup: api.secret.internal')),
        deviceHasNetwork: true,
      );
      expect(f.userMessage, isNot(contains('api.secret.internal')));
      expect(f.describe(), isNot(contains('api.secret.internal')));
    });
  });
}
