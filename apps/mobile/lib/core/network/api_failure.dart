import 'package:flutter/foundation.dart';

import '../session/signed_out_reason.dart';
import 'api_error_code.dart';
import 'user_messages.dart';

/// Every failed API call surfaces as exactly one [ApiFailure]. Screens show
/// [userMessage] — never an exception's text or the raw response.
@immutable
sealed class ApiFailure implements Exception {
  const ApiFailure();

  /// Friendly Uzbek text for the UI.
  String get userMessage;

  /// Whether repeating the same request later can succeed.
  bool get retryable;

  /// How long the server asked us to wait, if it did.
  Duration? get retryAfter => null;

  @override
  String toString() => '$runtimeType(${describe()})';

  /// Log-safe description (no URLs, headers or bodies).
  String describe();
}

/// The device has no network connection at all.
final class NoNetworkFailure extends ApiFailure {
  const NoNetworkFailure();
  @override
  String get userMessage => UserMessages.noNetwork;
  @override
  bool get retryable => true;
  @override
  String describe() => 'no network';
}

/// The device is online but the API could not be reached (DNS, refused or
/// reset connection, proxy/captive portal).
final class ApiUnreachableFailure extends ApiFailure {
  const ApiUnreachableFailure();
  @override
  String get userMessage => UserMessages.apiUnreachable;
  @override
  bool get retryable => true;
  @override
  String describe() => 'api unreachable';
}

/// Connect, send or receive took longer than the configured timeout. The
/// request may or may not have reached the server.
final class TimeoutFailure extends ApiFailure {
  const TimeoutFailure(this.phase);
  final String phase;
  @override
  String get userMessage => UserMessages.timeout;
  @override
  bool get retryable => true;
  @override
  String describe() => 'timeout ($phase)';
}

/// TLS failed (certificate). Never retried; never bypassed.
final class InsecureConnectionFailure extends ApiFailure {
  const InsecureConnectionFailure();
  @override
  String get userMessage => UserMessages.insecure;
  @override
  bool get retryable => false;
  @override
  String describe() => 'bad certificate';
}

/// The caller cancelled the request.
final class CancelledFailure extends ApiFailure {
  const CancelledFailure();
  @override
  String get userMessage => UserMessages.cancelled;
  @override
  bool get retryable => false;
  @override
  String describe() => 'cancelled';
}

/// A field error from VALIDATION_ERROR (`details[]`).
@immutable
class FieldError {
  const FieldError(this.path, this.message);
  final String path;
  final String message;

  @override
  bool operator ==(Object other) => other is FieldError && other.path == path && other.message == message;
  @override
  int get hashCode => Object.hash(path, message);
}

/// The API answered with an error status.
final class ApiHttpFailure extends ApiFailure {
  const ApiHttpFailure({
    required this.statusCode,
    required this.code,
    this.rawCode,
    this.serverMessage,
    this.requestId,
    this.retryAfter,
    this.fieldErrors = const [],
  });

  final int statusCode;
  final ApiErrorCode code;

  /// The code string as sent (kept when [code] is [ApiErrorCode.unknown]).
  final String? rawCode;

  /// `ErrorResponse.error` — the backend's own (Uzbek) message. Shown only
  /// for validation/conflict errors where it is the most specific text.
  final String? serverMessage;

  /// `ErrorResponse.requestId` — shown in error details for support.
  final String? requestId;

  @override
  final Duration? retryAfter;

  final List<FieldError> fieldErrors;

  ApiErrorKind get kind => code.kind;

  @override
  bool get retryable => code == ApiErrorCode.unknown ? statusCode >= 500 : kind.retryable;

  @override
  String get userMessage => UserMessages.forHttp(this);

  @override
  String describe() =>
      'HTTP $statusCode ${code == ApiErrorCode.unknown ? (rawCode ?? '-') : code.wire}'
      '${requestId == null ? '' : ' requestId=$requestId'}'
      '${retryAfter == null ? '' : ' retryAfter=${retryAfter!.inMilliseconds}ms'}';
}

/// The API answered with something that is not the documented contract
/// (e.g. HTML from a proxy, or a body that does not parse).
final class UnexpectedResponseFailure extends ApiFailure {
  const UnexpectedResponseFailure({this.statusCode, required this.reason});
  final int? statusCode;
  final String reason;
  @override
  String get userMessage => UserMessages.unexpected;
  @override
  bool get retryable => statusCode == null || statusCode! >= 500;
  @override
  String describe() => 'unexpected response ${statusCode ?? '-'}: $reason';
}

/// The session can no longer be used (terminal refresh answer, logout, or
/// no session at all): the request was not sent or not retried. The app is
/// already on its way to the sign-in screen.
final class SessionEndedFailure extends ApiFailure {
  const SessionEndedFailure(this.reason);
  final SignedOutReason reason;
  @override
  String get userMessage => UserMessages.forSignedOut(reason) ?? UserMessages.signInRequired;
  @override
  bool get retryable => false;
  @override
  String describe() => 'session ended (${reason.name})';
}

/// Secure storage refused to read or save the session. Nothing was
/// claimed as signed in.
final class SecureStorageFailure extends ApiFailure {
  const SecureStorageFailure(this.operation);
  final String operation;
  @override
  String get userMessage => UserMessages.secureStorage;
  @override
  bool get retryable => true;
  @override
  String describe() => 'secure storage $operation failed';
}
