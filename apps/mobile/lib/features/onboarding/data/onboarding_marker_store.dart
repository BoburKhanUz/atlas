import '../../../core/logging/app_log.dart';
import '../../../core/session/token_store.dart';

/// How onboarding ended for a user on this device.
enum OnboardingMarker { completed, skipped }

/// A per-user, client-side UX marker ("onboarding was shown here") in
/// secure storage. It is NOT the server's view of the account and holds no
/// answers. Failures are logged and ignored: worst case, onboarding is
/// offered again.
class OnboardingMarkerStore {
  OnboardingMarkerStore(this._kv);
  final SecureKeyValueStore _kv;

  static String keyFor(String userId) => 'atlas.onboarding.v1.${userId.replaceAll(RegExp('[^A-Za-z0-9_-]'), '_')}';

  Future<OnboardingMarker?> read(String userId) async {
    try {
      final raw = await _kv.read(keyFor(userId)).timeout(const Duration(seconds: 5));
      return OnboardingMarker.values.where((m) => m.name == raw).firstOrNull;
    } on Object catch (e) {
      AppLog.warn('onboarding marker unreadable (${e.runtimeType})');
      return null;
    }
  }

  Future<void> write(String userId, OnboardingMarker marker) async {
    try {
      await _kv.write(keyFor(userId), marker.name).timeout(const Duration(seconds: 5));
    } on Object catch (e) {
      AppLog.warn('onboarding marker not saved (${e.runtimeType})');
    }
  }
}
