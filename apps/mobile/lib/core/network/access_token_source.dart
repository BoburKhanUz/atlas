/// Where the HTTP layer gets the current access token from: the
/// secure-storage session (`SessionController`), or [NoAccessToken].
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
