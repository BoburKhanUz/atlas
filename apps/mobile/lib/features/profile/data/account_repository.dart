import '../../../core/network/api_client.dart';

/// DELETE /api/v1/account: immediate, irreversible, deletes every session.
/// ONE request, never retried automatically. Throws `ApiFailure`.
class AccountRepository {
  AccountRepository(this._client);
  final AtlasApiClient _client;

  Future<void> delete() => _client.callVoid((api) => api.getAccountApi().deleteAccount());
}
