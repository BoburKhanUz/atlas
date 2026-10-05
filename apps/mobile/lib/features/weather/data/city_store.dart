import '../../../core/logging/app_log.dart';
import '../../../core/session/token_store.dart';
import 'cities.dart';

/// The manually chosen city, per user, in secure storage. Only the city id
/// is stored — never coordinates, weather or location history.
class CityStore {
  CityStore(this._kv);
  final SecureKeyValueStore _kv;

  static String keyFor(String userId) => 'atlas.weather.city.${userId.replaceAll(RegExp('[^A-Za-z0-9_-]'), '_')}';

  /// The stored city, or null (none, unknown id, unreadable storage).
  Future<City?> read(String userId) async {
    try {
      return Cities.byId(await _kv.read(keyFor(userId)).timeout(const Duration(seconds: 5)));
    } on Object catch (e) {
      AppLog.warn('city preference unreadable (${e.runtimeType})');
      return null;
    }
  }

  Future<void> save(String userId, City city) async {
    try {
      await _kv.write(keyFor(userId), city.id).timeout(const Duration(seconds: 5));
    } on Object catch (e) {
      AppLog.warn('city preference not saved (${e.runtimeType})');
    }
  }

  Future<void> clear(String userId) async {
    try {
      await _kv.delete(keyFor(userId)).timeout(const Duration(seconds: 5));
    } on Object catch (e) {
      AppLog.warn('city preference not cleared (${e.runtimeType})');
    }
  }
}
