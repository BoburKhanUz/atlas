/// Where the HTTP layer gets the current access token from. Phase 3.3
/// (session) provides the real implementation backed by secure storage;
/// until then there is no session.
abstract interface class AccessTokenSource {
  /// The access token to send as `Authorization: Bearer …`, or null when
  /// signed out. Never logged.
  Future<String?> currentAccessToken();
}

class NoAccessToken implements AccessTokenSource {
  const NoAccessToken();
  @override
  Future<String?> currentAccessToken() async => null;
}
