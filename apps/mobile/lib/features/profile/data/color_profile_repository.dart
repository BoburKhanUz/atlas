import 'package:atlas_api/atlas_api.dart'
    show ColorProfileResponseOneOf, ColorProfileResponseOneOf1, ColorProfileResponseOneOf1ColorProfile;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../outfits/data/generated_outfits.dart' show NullableText;
import '../../wardrobe/data/image_preparer.dart' show PreparedImage;

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
  });

  final DateTime analyzedAt;
  final String? season;
  final String? undertone;
  final String? contrastLevel;
  final List<String> recommendedColors;
  final List<String> neutralColors;
  final List<String> cautionColors;
  final String? skinTone;
  final String? hairColor;
  final String? eyeColor;

  /// Only an analysis response carries it (GET does not).
  final num? confidence;

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
/// Idempotency-Key exists for it) and is never retried automatically.
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
      ),
      r.disclaimer,
    );
  }
}
