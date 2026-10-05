import 'package:atlas_api/atlas_api.dart' show ProfilePatchRequest, standardSerializers;

import '../../../core/network/api_client.dart';

/// The two profile operations onboarding needs (GET/PATCH /api/v1/profile).
class ProfileRepository {
  ProfileRepository(this._client);
  final AtlasApiClient _client;

  /// Whether the account already has any style or colour preference.
  /// Throws `ApiFailure`.
  Future<bool> hasStylePreferences() async {
    final response = await _client.call((api) => api.getProfileApi().getProfile());
    final p = response.preferences;
    if (p == null) return false;
    return p.preferredStyles.isNotEmpty ||
        p.dislikedStyles.isNotEmpty ||
        p.favoriteColors.isNotEmpty ||
        p.dislikedColors.isNotEmpty;
  }

  /// One PATCH /api/v1/profile with exactly [patch] (contract JSON). Not
  /// retried automatically. Throws `ApiFailure`.
  Future<void> update(Map<String, Object?> patch) async {
    final request = standardSerializers.deserializeWith(ProfilePatchRequest.serializer, patch)!;
    await _client.call((api) => api.getProfileApi().updateProfile(profilePatchRequest: request));
  }
}
