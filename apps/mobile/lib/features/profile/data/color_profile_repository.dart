import 'package:atlas_api/atlas_api.dart'
    show
        ColorAnalysisResponseColorProfileSecondaryConfidence,
        ColorProfileResponseOneOf,
        ColorProfileResponseOneOf1,
        ColorProfileResponseOneOf1ColorProfile;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../outfits/data/generated_outfits.dart' show NullableText;
import '../../wardrobe/data/image_preparer.dart' show PreparedImage;

extension on ColorAnalysisResponseColorProfileSecondaryConfidence? {
  num? get number => this?.anyOf.values.values.whereType<num>().firstOrNull;
}

/// A colour profile result (from GET or from an analysis).
@immutable
class ColorProfile {
  const ColorProfile({
    required this.analyzedAt,
    required this.recommendedColors,
    required this.neutralColors,
    required this.cautionColors,
    this.season,
    this.undertone,
    this.contrastLevel,
    this.skinTone,
    this.hairColor,
    this.eyeColor,
    this.confidence,
    this.undertoneConfidence,
    this.secondarySeason,
    this.secondaryConfidence,
  });

  final DateTime analyzedAt;

  /// null when the photo did not support any season.
  final String? season;

  /// warm, neutral_warm, neutral, neutral_cool, cool or unknown.
  final String? undertone;
  final String? contrastLevel;
  final List<String> recommendedColors;
  final List<String> neutralColors;
  final List<String> cautionColors;
  final String? skinTone;
  final String? hairColor;
  final String? eyeColor;

  /// Overall confidence (0–0.8); null for profiles from before Phase 4.3.
  final num? confidence;
  final num? undertoneConfidence;

  /// The next closest season (null when unknown).
  final String? secondarySeason;
  final num? secondaryConfidence;

  /// Never prints colour results.
  @override
  String toString() => 'ColorProfile';
}

/// `GET /api/v1/color-profile`: the server's current state.
sealed class ColorProfileState {
  const ColorProfileState();
}

final class NotAnalysed extends ColorProfileState {
  const NotAnalysed(this.message);
  final String message;
}

final class Analysed extends ColorProfileState {
  const Analysed(this.profile, this.disclaimer);
  final ColorProfile profile;
  final String disclaimer;
}

/// Colour profile operations. [analyze] is ONE multipart POST (no
/// Idempotency-Key exists for it) and is never retried automatically; it
/// replaces the current profile. [delete] removes it (idempotent).
class ColorProfileRepository {
  ColorProfileRepository(this._client);
  final AtlasApiClient _client;

  Future<ColorProfileState> current() async {
    final r = await _client.call((api) => api.getProfileApi().getColorProfile());
    return switch (r.oneOf.value) {
      final ColorProfileResponseOneOf1 a => Analysed(_ofCurrent(a.colorProfile), a.disclaimer),
      final ColorProfileResponseOneOf n => NotAnalysed(n.message),
      _ => throw StateError('unexpected colour profile variant'),
    };
  }

  static ColorProfile _ofCurrent(ColorProfileResponseOneOf1ColorProfile c) => ColorProfile(
    analyzedAt: c.analyzedAt,
    season: c.season,
    undertone: c.undertone,
    contrastLevel: c.contrastLevel,
    recommendedColors: c.recommendedColors.toList(),
    neutralColors: c.neutralColors.toList(),
    cautionColors: c.cautionColors.toList(),
    skinTone: c.skinTone,
    hairColor: c.hairColor,
    eyeColor: c.eyeColor,
    confidence: c.confidence,
    undertoneConfidence: c.undertoneConfidence,
    secondarySeason: c.secondarySeason,
    secondaryConfidence: c.secondaryConfidence,
  );

  /// The prepared (JPEG, metadata-free) selfie bytes go up once; the server
  /// does not store them.
  Future<Analysed> analyze(PreparedImage image) async {
    final r = await _client.call(
      (api) => api.getProfileApi().analyzeColorProfile(
        file: MultipartFile.fromBytes(
          image.bytes,
          filename: image.filename,
          contentType: DioMediaType('image', 'jpeg'),
        ),
      ),
    );
    final c = r.colorProfile;
    return Analysed(
      ColorProfile(
        analyzedAt: c.analyzedAt,
        season: c.season.text,
        undertone: c.undertone.text,
        contrastLevel: c.contrastLevel.text,
        recommendedColors: c.recommendedColors.toList(),
        neutralColors: c.neutralColors.toList(),
        cautionColors: c.cautionColors.toList(),
        skinTone: c.skinTone.text,
        hairColor: c.hairColor.text,
        eyeColor: c.eyeColor.text,
        confidence: c.confidence,
        undertoneConfidence: c.undertoneConfidence.number,
        secondarySeason: c.secondarySeason.text,
        secondaryConfidence: c.secondaryConfidence.number,
      ),
      r.disclaimer,
    );
  }

  /// Deletes the colour profile and the selfie-derived values (skin tone,
  /// undertone, hair and eye colour) on the server. Safe to repeat.
  Future<void> delete() => _client.call((api) => api.getProfileApi().deleteColorProfile());
}
