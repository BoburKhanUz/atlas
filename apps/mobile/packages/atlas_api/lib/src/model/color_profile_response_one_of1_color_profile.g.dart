// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_profile_response_one_of1_color_profile.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ColorProfileResponseOneOf1ColorProfile extends ColorProfileResponseOneOf1ColorProfile {
  @override
  final DateTime analyzedAt;
  @override
  final BuiltList<String> cautionColors;
  @override
  final String? contrastLevel;
  @override
  final String? eyeColor;
  @override
  final String? hairColor;
  @override
  final String id;
  @override
  final BuiltList<String> neutralColors;
  @override
  final BuiltList<String> recommendedColors;
  @override
  final String? season;
  @override
  final String? skinTone;
  @override
  final String? undertone;

  factory _$ColorProfileResponseOneOf1ColorProfile([
    void Function(ColorProfileResponseOneOf1ColorProfileBuilder)? updates,
  ]) => (ColorProfileResponseOneOf1ColorProfileBuilder()..update(updates))._build();

  _$ColorProfileResponseOneOf1ColorProfile._({
    required this.analyzedAt,
    required this.cautionColors,
    this.contrastLevel,
    this.eyeColor,
    this.hairColor,
    required this.id,
    required this.neutralColors,
    required this.recommendedColors,
    this.season,
    this.skinTone,
    this.undertone,
  }) : super._();
  @override
  ColorProfileResponseOneOf1ColorProfile rebuild(
    void Function(ColorProfileResponseOneOf1ColorProfileBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  ColorProfileResponseOneOf1ColorProfileBuilder toBuilder() =>
      ColorProfileResponseOneOf1ColorProfileBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorProfileResponseOneOf1ColorProfile &&
        analyzedAt == other.analyzedAt &&
        cautionColors == other.cautionColors &&
        contrastLevel == other.contrastLevel &&
        eyeColor == other.eyeColor &&
        hairColor == other.hairColor &&
        id == other.id &&
        neutralColors == other.neutralColors &&
        recommendedColors == other.recommendedColors &&
        season == other.season &&
        skinTone == other.skinTone &&
        undertone == other.undertone;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, analyzedAt.hashCode);
    _$hash = $jc(_$hash, cautionColors.hashCode);
    _$hash = $jc(_$hash, contrastLevel.hashCode);
    _$hash = $jc(_$hash, eyeColor.hashCode);
    _$hash = $jc(_$hash, hairColor.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, neutralColors.hashCode);
    _$hash = $jc(_$hash, recommendedColors.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, skinTone.hashCode);
    _$hash = $jc(_$hash, undertone.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorProfileResponseOneOf1ColorProfile')
          ..add('analyzedAt', analyzedAt)
          ..add('cautionColors', cautionColors)
          ..add('contrastLevel', contrastLevel)
          ..add('eyeColor', eyeColor)
          ..add('hairColor', hairColor)
          ..add('id', id)
          ..add('neutralColors', neutralColors)
          ..add('recommendedColors', recommendedColors)
          ..add('season', season)
          ..add('skinTone', skinTone)
          ..add('undertone', undertone))
        .toString();
  }
}

class ColorProfileResponseOneOf1ColorProfileBuilder
    implements Builder<ColorProfileResponseOneOf1ColorProfile, ColorProfileResponseOneOf1ColorProfileBuilder> {
  _$ColorProfileResponseOneOf1ColorProfile? _$v;

  DateTime? _analyzedAt;
  DateTime? get analyzedAt => _$this._analyzedAt;
  set analyzedAt(DateTime? analyzedAt) => _$this._analyzedAt = analyzedAt;

  ListBuilder<String>? _cautionColors;
  ListBuilder<String> get cautionColors => _$this._cautionColors ??= ListBuilder<String>();
  set cautionColors(ListBuilder<String>? cautionColors) => _$this._cautionColors = cautionColors;

  String? _contrastLevel;
  String? get contrastLevel => _$this._contrastLevel;
  set contrastLevel(String? contrastLevel) => _$this._contrastLevel = contrastLevel;

  String? _eyeColor;
  String? get eyeColor => _$this._eyeColor;
  set eyeColor(String? eyeColor) => _$this._eyeColor = eyeColor;

  String? _hairColor;
  String? get hairColor => _$this._hairColor;
  set hairColor(String? hairColor) => _$this._hairColor = hairColor;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ListBuilder<String>? _neutralColors;
  ListBuilder<String> get neutralColors => _$this._neutralColors ??= ListBuilder<String>();
  set neutralColors(ListBuilder<String>? neutralColors) => _$this._neutralColors = neutralColors;

  ListBuilder<String>? _recommendedColors;
  ListBuilder<String> get recommendedColors => _$this._recommendedColors ??= ListBuilder<String>();
  set recommendedColors(ListBuilder<String>? recommendedColors) => _$this._recommendedColors = recommendedColors;

  String? _season;
  String? get season => _$this._season;
  set season(String? season) => _$this._season = season;

  String? _skinTone;
  String? get skinTone => _$this._skinTone;
  set skinTone(String? skinTone) => _$this._skinTone = skinTone;

  String? _undertone;
  String? get undertone => _$this._undertone;
  set undertone(String? undertone) => _$this._undertone = undertone;

  ColorProfileResponseOneOf1ColorProfileBuilder() {
    ColorProfileResponseOneOf1ColorProfile._defaults(this);
  }

  ColorProfileResponseOneOf1ColorProfileBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _analyzedAt = $v.analyzedAt;
      _cautionColors = $v.cautionColors.toBuilder();
      _contrastLevel = $v.contrastLevel;
      _eyeColor = $v.eyeColor;
      _hairColor = $v.hairColor;
      _id = $v.id;
      _neutralColors = $v.neutralColors.toBuilder();
      _recommendedColors = $v.recommendedColors.toBuilder();
      _season = $v.season;
      _skinTone = $v.skinTone;
      _undertone = $v.undertone;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorProfileResponseOneOf1ColorProfile other) {
    _$v = other as _$ColorProfileResponseOneOf1ColorProfile;
  }

  @override
  void update(void Function(ColorProfileResponseOneOf1ColorProfileBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorProfileResponseOneOf1ColorProfile build() => _build();

  _$ColorProfileResponseOneOf1ColorProfile _build() {
    _$ColorProfileResponseOneOf1ColorProfile _$result;
    try {
      _$result =
          _$v ??
          _$ColorProfileResponseOneOf1ColorProfile._(
            analyzedAt: BuiltValueNullFieldError.checkNotNull(
              analyzedAt,
              r'ColorProfileResponseOneOf1ColorProfile',
              'analyzedAt',
            ),
            cautionColors: cautionColors.build(),
            contrastLevel: contrastLevel,
            eyeColor: eyeColor,
            hairColor: hairColor,
            id: BuiltValueNullFieldError.checkNotNull(id, r'ColorProfileResponseOneOf1ColorProfile', 'id'),
            neutralColors: neutralColors.build(),
            recommendedColors: recommendedColors.build(),
            season: season,
            skinTone: skinTone,
            undertone: undertone,
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'cautionColors';
        cautionColors.build();

        _$failedField = 'neutralColors';
        neutralColors.build();
        _$failedField = 'recommendedColors';
        recommendedColors.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ColorProfileResponseOneOf1ColorProfile', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
