import 'package:atlas_api/atlas_api.dart' show ProfilePatchRequest, standardSerializers;

import '../../../core/network/api_client.dart';
import '../../onboarding/data/options.dart';
import 'profile_data.dart';

/// GET/PATCH /api/v1/profile for the fields the contract exposes. Throws
/// `ApiFailure`. PATCH is ONE request, never retried automatically.
class AccountProfileRepository {
  AccountProfileRepository(this._client);
  final AtlasApiClient _client;

  Future<ProfileData> get() async {
    final r = await _client.call((api) => api.getProfileApi().getProfile());
    final p = r.preferences;
    Set<T> parse<T>(Iterable<String>? wires, T? Function(String) of) => {
      for (final w in wires ?? const <String>[]) ?of(w),
    };
    StyleOption? style(String w) => StyleOption.values.where((o) => o.wire == w).firstOrNull;
    ColorOption? color(String w) => ColorOption.values.where((o) => o.wire == w).firstOrNull;
    return ProfileData(
      email: r.user.email,
      name: r.user.name,
      preferredStyles: parse(p?.preferredStyles, style),
      dislikedStyles: parse(p?.dislikedStyles, style),
      favoriteColors: parse(p?.favoriteColors, color),
      dislikedColors: parse(p?.dislikedColors, color),
    );
  }

  /// [patch] is contract JSON; it is validated through the generated types
  /// (an unknown value throws before anything is sent).
  Future<void> update(Map<String, Object?> patch) async {
    final ProfilePatchRequest request;
    try {
      request = standardSerializers.deserializeWith(ProfilePatchRequest.serializer, patch)!;
    } on Object {
      throw ArgumentError('value outside the contract');
    }
    await _client.call((api) => api.getProfileApi().updateProfile(profilePatchRequest: request));
  }
}
