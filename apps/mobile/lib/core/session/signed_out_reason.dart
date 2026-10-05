/// Why the user is (back) on the sign-in screen.
enum SignedOutReason {
  /// Fresh install, or never signed in on this device.
  none,

  /// The user signed out.
  loggedOut,

  /// SESSION_EXPIRED, or the 90-day limit passed (also checked locally).
  expired,

  /// SESSION_REVOKED or INVALID_TOKEN: signed out elsewhere, or the session
  /// no longer exists.
  revoked,

  /// REFRESH_REUSED: the refresh token was presented twice — the whole
  /// session was ended for safety.
  reused,

  /// CLIENT_MISMATCH: the token belongs to a web session.
  clientMismatch,

  /// Two SESSION_RACE answers in one recovery episode (vector V04).
  raced,

  /// Any other rejected refresh (an unknown 401, a 400).
  rejected,

  /// The stored session could not be read from secure storage.
  storageUnavailable,

  /// The user deleted their account (DELETE /api/v1/account confirmed).
  accountDeleted,
}
