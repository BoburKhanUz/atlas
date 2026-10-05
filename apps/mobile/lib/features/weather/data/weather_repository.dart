import 'package:atlas_api/atlas_api.dart' show WeatherResponseWeather;

import '../../../core/network/api_client.dart';
import 'location.dart';

/// GET /api/v1/weather/current — only ever with a [RoundedLocation].
class WeatherRepository {
  WeatherRepository(this._client);
  final AtlasApiClient _client;

  Future<WeatherResponseWeather> current(RoundedLocation location) async =>
      (await _client.call((api) => api.getWeatherApi().getCurrentWeather(lat: location.lat, lon: location.lon)))
          .weather;
}
