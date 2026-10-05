import 'package:atlas_api/atlas_api.dart'
    show
        ColorAnalysisResponseColorProfileContrastLevel,
        OutfitGenerateResponse,
        OutfitGenerateResponseOutfitsInner,
        OutfitGenerateResponseWeatherUsedAnyOf,
        standardSerializers;
import 'package:built_collection/built_collection.dart';
import 'package:built_value/serializer.dart' show DeserializationError;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

/// The generated client types several nullable strings (`anyOf: [string,
/// null]`) as this wrapper; [text] reads the string (or null).
extension NullableText on ColorAnalysisResponseColorProfileContrastLevel? {
  String? get text => this?.anyOf.values.values.whereType<String>().firstOrNull;
}

/// The answer of POST /api/v1/outfits/generate. Candidates are NOT stored
/// on the server (they only have a `tempId`).
@immutable
class GeneratedOutfits {
  const GeneratedOutfits({
    required this.outfits,
    required this.weatherUsed,
    required this.occasion,
    required this.wardrobeItemCount,
    this.message,
  });

  factory GeneratedOutfits.from(OutfitGenerateResponse r, {required bool weatherUsedIsNull}) => GeneratedOutfits(
    outfits: r.outfits,
    weatherUsed: weatherUsedIsNull
        ? null
        : r.weatherUsed.anyOf.values.values.whereType<OutfitGenerateResponseWeatherUsedAnyOf>().firstOrNull,
    occasion: r.occasion.text,
    wardrobeItemCount: r.wardrobeItemCount,
    message: r.message,
  );

  final BuiltList<OutfitGenerateResponseOutfitsInner> outfits;

  /// The weather the suggestions were made for; null when none was used
  /// (no location, weather unavailable, empty wardrobe).
  final OutfitGenerateResponseWeatherUsedAnyOf? weatherUsed;
  final String? occasion;
  final int wardrobeItemCount;

  /// Why there are no suggestions (e.g. the wardrobe is empty).
  final String? message;
}

// ─── TEMPORARY contract/generator workaround (Phase 3.7, decision D1) ──────
//
// `OutfitGenerateResponse.weatherUsed` is `anyOf: [{inline object}, null]`.
// The pinned openapi-generator (dart-dio) wraps it in a NON-nullable `AnyOf`
// class, so a legitimate `"weatherUsed": null` (empty wardrobe, no location,
// weather unavailable) fails to deserialize. Until the contract uses a named
// schema (or the generator handles it), the ONE affected response is
// re-validated here:
//
//   * only a 2xx body of this operation, only after the generated
//     deserializer rejected it, and only when `weatherUsed` is present and
//     exactly null;
//   * the body is then deserialized by the GENERATED serializer with a
//     placeholder in `weatherUsed`, so every other field is still checked
//     exactly as before — any other mismatch still fails;
//   * the placeholder is never exposed: the result carries `weatherUsed: null`.
//
// Remove when the contract/generator is fixed (see docs/architecture/
// mobile-app.md, "Contract follow-ups").

const _placeholderWeather = <String, Object>{
  'temperature': 0,
  'feelsLike': 0,
  'condition': 'placeholder',
  'precipitationProbability': 0,
  'humidity': 0,
  'windSpeed': 0,
  'uvIndex': 0,
};

/// Decodes a generate body whose `weatherUsed` is null. Returns null when the
/// workaround does not apply; throws when the rest of the body does not match
/// the contract.
@visibleForTesting
GeneratedOutfits? decodeWithNullWeatherUsed(Object? body) {
  if (body is! Map || !body.containsKey('weatherUsed') || body['weatherUsed'] != null) return null;
  final patched = <String, Object?>{for (final e in body.entries) e.key as String: e.value}
    ..['weatherUsed'] = _placeholderWeather;
  final response = standardSerializers.deserializeWith(OutfitGenerateResponse.serializer, patched)!;
  return GeneratedOutfits.from(response, weatherUsedIsNull: true);
}

/// For a failed generated `generateOutfits` call: the decoded answer when the
/// only problem was a null `weatherUsed`, else null (the caller rethrows the
/// original error, so unrelated problems are never hidden).
GeneratedOutfits? recoverNullWeatherUsed(DioException e) {
  final response = e.response;
  final status = response?.statusCode ?? 0;
  if (e.error is! DeserializationError || response == null || status < 200 || status >= 300) return null;
  try {
    return decodeWithNullWeatherUsed(response.data);
  } on Object {
    return null;
  }
}
