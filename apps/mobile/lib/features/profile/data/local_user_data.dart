import '../../../core/logging/app_log.dart';
import '../../../core/session/token_store.dart';
import '../../onboarding/data/onboarding_marker_store.dart';
import '../../wardrobe/data/pending_upload_store.dart';
import '../../weather/data/city_store.dart';

/// Every per-user key the app keeps in secure storage. Account deletion
/// removes exactly these for the deleted user — never another user's.
abstract final class LocalUserData {
  static List<String> keysFor(String userId) => [
    OnboardingMarkerStore.keyFor(userId),
    PendingUploadStore.keyFor(userId),
    CityStore.keyFor(userId),
  ];

  /// Deletes them; a failure is logged (type only) and the rest continue.
  static Future<void> clear(SecureKeyValueStore kv, String userId) async {
    for (final key in keysFor(userId)) {
      try {
        await kv.delete(key).timeout(const Duration(seconds: 5));
      } on Object catch (e) {
        AppLog.warn('a local per-user value was not deleted (${e.runtimeType})');
      }
    }
  }
}
