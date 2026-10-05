import 'package:atlas_api/atlas_api.dart' show AuthResponse, MobileAuthResponse;

/// The contract types login/register/refresh responses as
/// `anyOf [MobileAuthResponse, WebAuthResponse]` (mobile mode returns the
/// token body). The generated `AnyOf` keeps every alternative that parsed;
/// this picks the mobile one, or null when the body had no tokens (which in
/// mobile mode is a contract violation the caller must treat as a failure).
extension MobileAuthResponseX on AuthResponse {
  MobileAuthResponse? get mobile => anyOf.values.values.whereType<MobileAuthResponse>().firstOrNull;
}
