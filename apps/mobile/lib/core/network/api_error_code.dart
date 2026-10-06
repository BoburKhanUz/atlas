/// Every `ErrorResponse.code` of docs/api/openapi.json, plus [unknown] for
/// codes a newer backend may add. Wire names are the contract values.
enum ApiErrorCode {
  badRequest('BAD_REQUEST', ApiErrorKind.invalidRequest),
  validationError('VALIDATION_ERROR', ApiErrorKind.invalidRequest),
  unauthorized('UNAUTHORIZED', ApiErrorKind.unauthorized),
  forbidden('FORBIDDEN', ApiErrorKind.forbidden),
  notFound('NOT_FOUND', ApiErrorKind.notFound),
  conflict('CONFLICT', ApiErrorKind.conflict),
  payloadTooLarge('PAYLOAD_TOO_LARGE', ApiErrorKind.invalidImage),
  unsupportedMediaType('UNSUPPORTED_MEDIA_TYPE', ApiErrorKind.invalidImage),
  invalidImage('INVALID_IMAGE', ApiErrorKind.invalidImage),
  unsupportedImageFormat('UNSUPPORTED_IMAGE_FORMAT', ApiErrorKind.invalidImage),
  imageDimensions('IMAGE_DIMENSIONS', ApiErrorKind.invalidImage),
  idempotencyKeyMismatch('IDEMPOTENCY_KEY_MISMATCH', ApiErrorKind.idempotencyMismatch),
  idempotencyInProgress('IDEMPOTENCY_IN_PROGRESS', ApiErrorKind.inProgress),
  rateLimited('RATE_LIMITED', ApiErrorKind.rateLimited),
  internal('INTERNAL', ApiErrorKind.server),
  invalidToken('INVALID_TOKEN', ApiErrorKind.sessionTerminal),
  sessionExpired('SESSION_EXPIRED', ApiErrorKind.sessionTerminal),
  sessionRevoked('SESSION_REVOKED', ApiErrorKind.sessionTerminal),
  refreshReused('REFRESH_REUSED', ApiErrorKind.sessionTerminal),
  sessionRace('SESSION_RACE', ApiErrorKind.sessionRace),
  clientMismatch('CLIENT_MISMATCH', ApiErrorKind.sessionTerminal),
  sessionBusy('SESSION_BUSY', ApiErrorKind.sessionBusy),
  notAGarment('NOT_A_GARMENT', ApiErrorKind.invalidImage),
  aiQuotaExceeded('AI_QUOTA_EXCEEDED', ApiErrorKind.rateLimited),
  aiUnavailable('AI_UNAVAILABLE', ApiErrorKind.server),
  unknown('', ApiErrorKind.unknown);

  const ApiErrorCode(this.wire, this.kind);

  /// The value in `ErrorResponse.code`.
  final String wire;
  final ApiErrorKind kind;

  static final _byWire = {for (final c in values) c.wire: c};

  static ApiErrorCode fromWire(String? value) => _byWire[value] ?? ApiErrorCode.unknown;

  /// Terminal session codes (client-recovery-vectors.json `terminalCodes`):
  /// delete the local tokens and show login; never retry, never call logout.
  bool get isTerminalSession => kind == ApiErrorKind.sessionTerminal;
}

/// How the app reacts to a backend error.
enum ApiErrorKind {
  /// 400 BAD_REQUEST / VALIDATION_ERROR — fix the input.
  invalidRequest(retryable: false),

  /// 401 UNAUTHORIZED — access token missing/expired: refresh (Phase 3.3).
  unauthorized(retryable: false),

  /// 403 — not allowed (e.g. cross-origin cookie request).
  forbidden(retryable: false),
  notFound(retryable: false),

  /// 409 CONFLICT, e.g. e-mail already registered.
  conflict(retryable: false),

  /// The image itself was rejected (format, size, dimensions, not decodable).
  invalidImage(retryable: false),

  /// Same Idempotency-Key, different payload: a client bug — start over with
  /// a new key.
  idempotencyMismatch(retryable: false),

  /// The same Idempotency-Key is still being processed — retry after
  /// Retry-After with the SAME key.
  inProgress(retryable: true),
  rateLimited(retryable: true),
  server(retryable: true),

  /// INVALID_TOKEN, SESSION_EXPIRED, SESSION_REVOKED, REFRESH_REUSED,
  /// CLIENT_MISMATCH.
  sessionTerminal(retryable: false),

  /// SESSION_RACE: retry per the recovery vectors (Phase 3.3).
  sessionRace(retryable: true),

  /// 503 SESSION_BUSY: retry after Retry-After.
  sessionBusy(retryable: true),
  unknown(retryable: false);

  const ApiErrorKind({required this.retryable});

  /// Whether repeating the same request later can succeed.
  final bool retryable;
}
