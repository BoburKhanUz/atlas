import 'package:atlas_api/atlas_api.dart' show PasswordForgotRequest;

import '../../../core/network/api_client.dart';

/// POST /api/v1/auth/password/forgot (public). The answer is the same whether
/// or not the e-mail has an account. The e-mailed link opens the web page that
/// sets the new password and signs out every device. Throws `ApiFailure`.
class PasswordResetRepository {
  PasswordResetRepository(this._client);
  final AtlasApiClient _client;

  Future<void> requestLink(String email) => _client.callVoid(
    (api) =>
        api.getAuthApi().requestPasswordReset(passwordForgotRequest: PasswordForgotRequest((b) => b..email = email)),
  );
}
