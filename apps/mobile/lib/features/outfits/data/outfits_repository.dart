import 'package:atlas_api/atlas_api.dart';
import 'package:built_collection/built_collection.dart';
import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../weather/data/location.dart';
import 'generated_outfits.dart';

/// Occasions of the contract (`OutfitGenerateRequest.occasion`).
const outfitOccasions = ['work', 'wedding', 'date', 'travel', 'casual', 'other'];

enum OutfitFeedback { liked, disliked }

/// The weather fields the generate/save requests accept.
typedef WeatherFields = ({
  num temperature,
  num feelsLike,
  String condition,
  num precipitationProbability,
  num humidity,
  num windSpeed,
  num uvIndex,
});

OutfitGenerateRequestWeather weatherRequest(WeatherFields w) => OutfitGenerateRequestWeather(
  (b) => b
    ..temperature = w.temperature
    ..feelsLike = w.feelsLike
    ..condition = w.condition
    ..precipitationProbability = w.precipitationProbability
    ..humidity = w.humidity
    ..windSpeed = w.windSpeed
    ..uvIndex = w.uvIndex,
);

WeatherFields fieldsOfCurrent(WeatherResponseWeather w) => (
  temperature: w.temperature,
  feelsLike: w.feelsLike,
  condition: w.condition,
  precipitationProbability: w.precipitationProbability,
  humidity: w.humidity,
  windSpeed: w.windSpeed,
  uvIndex: w.uvIndex,
);

WeatherFields fieldsOfUsed(OutfitGenerateResponseWeatherUsedAnyOf w) => (
  temperature: w.temperature,
  feelsLike: w.feelsLike,
  condition: w.condition,
  precipitationProbability: w.precipitationProbability,
  humidity: w.humidity,
  windSpeed: w.windSpeed,
  uvIndex: w.uvIndex,
);

/// A page of GET /api/v1/outfits with the server's `Date` (for the D4 check).
class OutfitList {
  const OutfitList(this.outfits, this.serverDate);
  final List<OutfitSummary> outfits;
  final DateTime? serverDate;
}

/// Outfit operations of docs/api/openapi.json. Every method throws
/// `ApiFailure`; none of the writes is ever retried automatically.
class OutfitsRepository {
  OutfitsRepository(this._client);
  final AtlasApiClient _client;

  /// Suggestions from the backend. Weather: [weather] when the app already
  /// has it, else [location] (rounded) for the server to look it up, else
  /// none.
  Future<GeneratedOutfits> generate({
    String? occasion,
    RoundedLocation? location,
    WeatherFields? weather,
    required int seed,
    int topN = 3,
  }) {
    final request = OutfitGenerateRequest(
      (b) => b
        ..occasion = outfitOccasions.contains(occasion) ? OutfitGenerateRequestOccasionEnum.valueOf(occasion!) : null
        ..weather = weather == null ? null : weatherRequest(weather).toBuilder()
        ..lat = weather == null ? location?.lat : null
        ..lon = weather == null ? location?.lon : null
        ..seed = seed
        ..topN = topN,
    );
    return _client.call((api) async {
      try {
        final r = await api.getOutfitsApi().generateOutfits(outfitGenerateRequest: request);
        final data = r.data;
        return _wrap(r, data == null ? null : GeneratedOutfits.from(data, weatherUsedIsNull: false));
      } on DioException catch (e) {
        final recovered = recoverNullWeatherUsed(e); // see generated_outfits.dart (D1)
        if (recovered == null) rethrow;
        return _wrap(e.response!, recovered);
      }
    });
  }

  static Response<GeneratedOutfits> _wrap(Response<Object?> r, GeneratedOutfits? data) =>
      Response(data: data, requestOptions: r.requestOptions, statusCode: r.statusCode, headers: r.headers);

  /// POST /api/v1/outfits — ONE request; returns the new outfit id.
  Future<String> save(OutfitSaveRequest request) async =>
      (await _client.call((api) => api.getOutfitsApi().saveOutfit(outfitSaveRequest: request))).outfit.id;

  Future<OutfitList> list({required bool savedOnly}) async {
    final r = await _client.callResponse((api) => api.getOutfitsApi().listOutfits(saved: savedOnly ? 'true' : null));
    return OutfitList(r.data!.outfits.toList(), _serverDate(r.headers));
  }

  static DateTime? _serverDate(Headers headers) {
    final value = headers.value('date');
    if (value == null) return null;
    try {
      return HttpDateParser.parse(value);
    } on FormatException {
      return null;
    }
  }

  Future<OutfitDetail> get(String id) async =>
      (await _client.call((api) => api.getOutfitsApi().getOutfit(id: id))).outfit;

  Future<OutfitRow> rename(String id, String name) => _patch(id, OutfitPatchRequest((b) => b..name = name));

  Future<OutfitRow> setSaved(String id, {required bool saved}) =>
      _patch(id, OutfitPatchRequest((b) => b..isSaved = saved));

  Future<OutfitRow> _patch(String id, OutfitPatchRequest request) async =>
      (await _client.call((api) => api.getOutfitsApi().updateOutfit(id: id, outfitPatchRequest: request))).outfit;

  Future<void> delete(String id) => _client.callVoid((api) => api.getOutfitsApi().deleteOutfit(id: id));

  Future<void> feedback(String id, OutfitFeedback kind) => _client.callVoid(
    (api) => api.getOutfitsApi().sendOutfitFeedback(
      id: id,
      outfitFeedbackRequest: OutfitFeedbackRequest(
        (b) => b..feedback = OutfitFeedbackRequestFeedbackEnum.valueOf(kind.name),
      ),
    ),
  );
}

/// The save request for a generated candidate.
OutfitSaveRequest saveRequestFor(
  OutfitGenerateResponseOutfitsInner candidate, {
  required String? occasion,
  required OutfitGenerateResponseWeatherUsedAnyOf? weatherUsed,
  required bool isSaved,
}) => OutfitSaveRequest(
  (b) => b
    ..items = ListBuilder([
      for (final i in candidate.items)
        OutfitSaveRequestItemsInner(
          (x) => x
            ..itemId = i.id
            ..role = i.role,
        ),
    ])
    ..occasion = outfitOccasions.contains(occasion) ? OutfitSaveRequestOccasionEnum.valueOf(occasion!) : null
    ..weather = weatherUsed == null ? null : weatherRequest(fieldsOfUsed(weatherUsed)).toBuilder()
    ..score = candidate.score
    ..reasons = ListBuilder(candidate.reasons)
    ..explanation = candidate.explanation.text
    ..isSaved = isSaved,
);

/// Simple HTTP-date (RFC 7231 IMF-fixdate) parser for the `Date` header.
abstract final class HttpDateParser {
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  static DateTime parse(String value) {
    final m = RegExp(r'^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$').firstMatch(value.trim());
    final month = m == null ? -1 : _months.indexOf(m[2]!);
    if (m == null || month < 0) throw const FormatException('not an HTTP date');
    return DateTime.utc(
      int.parse(m[3]!),
      month + 1,
      int.parse(m[1]!),
      int.parse(m[4]!),
      int.parse(m[5]!),
      int.parse(m[6]!),
    );
  }
}
