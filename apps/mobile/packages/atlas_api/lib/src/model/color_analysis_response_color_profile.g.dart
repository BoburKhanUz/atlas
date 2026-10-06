// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_analysis_response_color_profile.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ColorAnalysisResponseColorProfile extends ColorAnalysisResponseColorProfile {
  @override
  final DateTime analyzedAt;
  @override
  final BuiltList<String> cautionColors;
  @override
  final num confidence;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? contrastLevel;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? eyeColor;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? hairColor;
  @override
  final String id;
  @override
  final BuiltList<String> neutralColors;
  @override
  final BuiltList<String> recommendedColors;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? season;
  @override
  final ColorAnalysisResponseColorProfileSecondaryConfidence? secondaryConfidence;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? secondarySeason;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? skinTone;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? undertone;
  @override
  final ColorAnalysisResponseColorProfileSecondaryConfidence? undertoneConfidence;

  factory _$ColorAnalysisResponseColorProfile([void Function(ColorAnalysisResponseColorProfileBuilder)? updates]) =>
      (ColorAnalysisResponseColorProfileBuilder()..update(updates))._build();

  _$ColorAnalysisResponseColorProfile._({
    required this.analyzedAt,
    required this.cautionColors,
    required this.confidence,
    this.contrastLevel,
    this.eyeColor,
    this.hairColor,
    required this.id,
    required this.neutralColors,
    required this.recommendedColors,
    this.season,
    this.secondaryConfidence,
    this.secondarySeason,
    this.skinTone,
    this.undertone,
    this.undertoneConfidence,
  }) : super._();
  @override
  ColorAnalysisResponseColorProfile rebuild(void Function(ColorAnalysisResponseColorProfileBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ColorAnalysisResponseColorProfileBuilder toBuilder() => ColorAnalysisResponseColorProfileBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorAnalysisResponseColorProfile &&
        analyzedAt == other.analyzedAt &&
        cautionColors == other.cautionColors &&
        confidence == other.confidence &&
        contrastLevel == other.contrastLevel &&
        eyeColor == other.eyeColor &&
        hairColor == other.hairColor &&
        id == other.id &&
        neutralColors == other.neutralColors &&
        recommendedColors == other.recommendedColors &&
        season == other.season &&
        secondaryConfidence == other.secondaryConfidence &&
        secondarySeason == other.secondarySeason &&
        skinTone == other.skinTone &&
        undertone == other.undertone &&
        undertoneConfidence == other.undertoneConfidence;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, analyzedAt.hashCode);
    _$hash = $jc(_$hash, cautionColors.hashCode);
    _$hash = $jc(_$hash, confidence.hashCode);
    _$hash = $jc(_$hash, contrastLevel.hashCode);
    _$hash = $jc(_$hash, eyeColor.hashCode);
    _$hash = $jc(_$hash, hairColor.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, neutralColors.hashCode);
    _$hash = $jc(_$hash, recommendedColors.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, secondaryConfidence.hashCode);
    _$hash = $jc(_$hash, secondarySeason.hashCode);
    _$hash = $jc(_$hash, skinTone.hashCode);
    _$hash = $jc(_$hash, undertone.hashCode);
    _$hash = $jc(_$hash, undertoneConfidence.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorAnalysisResponseColorProfile')
          ..add('analyzedAt', analyzedAt)
          ..add('cautionColors', cautionColors)
          ..add('confidence', confidence)
          ..add('contrastLevel', contrastLevel)
          ..add('eyeColor', eyeColor)
          ..add('hairColor', hairColor)
          ..add('id', id)
          ..add('neutralColors', neutralColors)
          ..add('recommendedColors', recommendedColors)
          ..add('season', season)
          ..add('secondaryConfidence', secondaryConfidence)
          ..add('secondarySeason', secondarySeason)
          ..add('skinTone', skinTone)
          ..add('undertone', undertone)
          ..add('undertoneConfidence', undertoneConfidence))
        .toString();
  }
}

class ColorAnalysisResponseColorProfileBuilder
    implements Builder<ColorAnalysisResponseColorProfile, ColorAnalysisResponseColorProfileBuilder> {
  _$ColorAnalysisResponseColorProfile? _$v;

  DateTime? _analyzedAt;
  DateTime? get analyzedAt => _$this._analyzedAt;
  set analyzedAt(DateTime? analyzedAt) => _$this._analyzedAt = analyzedAt;

  ListBuilder<String>? _cautionColors;
  ListBuilder<String> get cautionColors => _$this._cautionColors ??= ListBuilder<String>();
  set cautionColors(ListBuilder<String>? cautionColors) => _$this._cautionColors = cautionColors;

  num? _confidence;
  num? get confidence => _$this._confidence;
  set confidence(num? confidence) => _$this._confidence = confidence;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _contrastLevel;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get contrastLevel =>
      _$this._contrastLevel ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set contrastLevel(ColorAnalysisResponseColorProfileContrastLevelBuilder? contrastLevel) =>
      _$this._contrastLevel = contrastLevel;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _eyeColor;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get eyeColor =>
      _$this._eyeColor ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set eyeColor(ColorAnalysisResponseColorProfileContrastLevelBuilder? eyeColor) => _$this._eyeColor = eyeColor;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _hairColor;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get hairColor =>
      _$this._hairColor ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set hairColor(ColorAnalysisResponseColorProfileContrastLevelBuilder? hairColor) => _$this._hairColor = hairColor;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ListBuilder<String>? _neutralColors;
  ListBuilder<String> get neutralColors => _$this._neutralColors ??= ListBuilder<String>();
  set neutralColors(ListBuilder<String>? neutralColors) => _$this._neutralColors = neutralColors;

  ListBuilder<String>? _recommendedColors;
  ListBuilder<String> get recommendedColors => _$this._recommendedColors ??= ListBuilder<String>();
  set recommendedColors(ListBuilder<String>? recommendedColors) => _$this._recommendedColors = recommendedColors;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _season;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get season =>
      _$this._season ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set season(ColorAnalysisResponseColorProfileContrastLevelBuilder? season) => _$this._season = season;

  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder? _secondaryConfidence;
  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder get secondaryConfidence =>
      _$this._secondaryConfidence ??= ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder();
  set secondaryConfidence(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder? secondaryConfidence) =>
      _$this._secondaryConfidence = secondaryConfidence;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _secondarySeason;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get secondarySeason =>
      _$this._secondarySeason ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set secondarySeason(ColorAnalysisResponseColorProfileContrastLevelBuilder? secondarySeason) =>
      _$this._secondarySeason = secondarySeason;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _skinTone;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get skinTone =>
      _$this._skinTone ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set skinTone(ColorAnalysisResponseColorProfileContrastLevelBuilder? skinTone) => _$this._skinTone = skinTone;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _undertone;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get undertone =>
      _$this._undertone ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set undertone(ColorAnalysisResponseColorProfileContrastLevelBuilder? undertone) => _$this._undertone = undertone;

  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder? _undertoneConfidence;
  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder get undertoneConfidence =>
      _$this._undertoneConfidence ??= ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder();
  set undertoneConfidence(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder? undertoneConfidence) =>
      _$this._undertoneConfidence = undertoneConfidence;

  ColorAnalysisResponseColorProfileBuilder() {
    ColorAnalysisResponseColorProfile._defaults(this);
  }

  ColorAnalysisResponseColorProfileBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _analyzedAt = $v.analyzedAt;
      _cautionColors = $v.cautionColors.toBuilder();
      _confidence = $v.confidence;
      _contrastLevel = $v.contrastLevel?.toBuilder();
      _eyeColor = $v.eyeColor?.toBuilder();
      _hairColor = $v.hairColor?.toBuilder();
      _id = $v.id;
      _neutralColors = $v.neutralColors.toBuilder();
      _recommendedColors = $v.recommendedColors.toBuilder();
      _season = $v.season?.toBuilder();
      _secondaryConfidence = $v.secondaryConfidence?.toBuilder();
      _secondarySeason = $v.secondarySeason?.toBuilder();
      _skinTone = $v.skinTone?.toBuilder();
      _undertone = $v.undertone?.toBuilder();
      _undertoneConfidence = $v.undertoneConfidence?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorAnalysisResponseColorProfile other) {
    _$v = other as _$ColorAnalysisResponseColorProfile;
  }

  @override
  void update(void Function(ColorAnalysisResponseColorProfileBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorAnalysisResponseColorProfile build() => _build();

  _$ColorAnalysisResponseColorProfile _build() {
    _$ColorAnalysisResponseColorProfile _$result;
    try {
      _$result =
          _$v ??
          _$ColorAnalysisResponseColorProfile._(
            analyzedAt: BuiltValueNullFieldError.checkNotNull(
              analyzedAt,
              r'ColorAnalysisResponseColorProfile',
              'analyzedAt',
            ),
            cautionColors: cautionColors.build(),
            confidence: BuiltValueNullFieldError.checkNotNull(
              confidence,
              r'ColorAnalysisResponseColorProfile',
              'confidence',
            ),
            contrastLevel: _contrastLevel?.build(),
            eyeColor: _eyeColor?.build(),
            hairColor: _hairColor?.build(),
            id: BuiltValueNullFieldError.checkNotNull(id, r'ColorAnalysisResponseColorProfile', 'id'),
            neutralColors: neutralColors.build(),
            recommendedColors: recommendedColors.build(),
            season: _season?.build(),
            secondaryConfidence: _secondaryConfidence?.build(),
            secondarySeason: _secondarySeason?.build(),
            skinTone: _skinTone?.build(),
            undertone: _undertone?.build(),
            undertoneConfidence: _undertoneConfidence?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'cautionColors';
        cautionColors.build();

        _$failedField = 'contrastLevel';
        _contrastLevel?.build();
        _$failedField = 'eyeColor';
        _eyeColor?.build();
        _$failedField = 'hairColor';
        _hairColor?.build();

        _$failedField = 'neutralColors';
        neutralColors.build();
        _$failedField = 'recommendedColors';
        recommendedColors.build();
        _$failedField = 'season';
        _season?.build();
        _$failedField = 'secondaryConfidence';
        _secondaryConfidence?.build();
        _$failedField = 'secondarySeason';
        _secondarySeason?.build();
        _$failedField = 'skinTone';
        _skinTone?.build();
        _$failedField = 'undertone';
        _undertone?.build();
        _$failedField = 'undertoneConfidence';
        _undertoneConfidence?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ColorAnalysisResponseColorProfile', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
