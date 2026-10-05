// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_analysis_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ColorAnalysisResponse extends ColorAnalysisResponse {
  @override
  final ColorAnalysisResponseColorProfile colorProfile;
  @override
  final String disclaimer;

  factory _$ColorAnalysisResponse([void Function(ColorAnalysisResponseBuilder)? updates]) =>
      (ColorAnalysisResponseBuilder()..update(updates))._build();

  _$ColorAnalysisResponse._({required this.colorProfile, required this.disclaimer}) : super._();
  @override
  ColorAnalysisResponse rebuild(void Function(ColorAnalysisResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ColorAnalysisResponseBuilder toBuilder() => ColorAnalysisResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorAnalysisResponse && colorProfile == other.colorProfile && disclaimer == other.disclaimer;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, colorProfile.hashCode);
    _$hash = $jc(_$hash, disclaimer.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorAnalysisResponse')
          ..add('colorProfile', colorProfile)
          ..add('disclaimer', disclaimer))
        .toString();
  }
}

class ColorAnalysisResponseBuilder implements Builder<ColorAnalysisResponse, ColorAnalysisResponseBuilder> {
  _$ColorAnalysisResponse? _$v;

  ColorAnalysisResponseColorProfileBuilder? _colorProfile;
  ColorAnalysisResponseColorProfileBuilder get colorProfile =>
      _$this._colorProfile ??= ColorAnalysisResponseColorProfileBuilder();
  set colorProfile(ColorAnalysisResponseColorProfileBuilder? colorProfile) => _$this._colorProfile = colorProfile;

  String? _disclaimer;
  String? get disclaimer => _$this._disclaimer;
  set disclaimer(String? disclaimer) => _$this._disclaimer = disclaimer;

  ColorAnalysisResponseBuilder() {
    ColorAnalysisResponse._defaults(this);
  }

  ColorAnalysisResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _colorProfile = $v.colorProfile.toBuilder();
      _disclaimer = $v.disclaimer;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorAnalysisResponse other) {
    _$v = other as _$ColorAnalysisResponse;
  }

  @override
  void update(void Function(ColorAnalysisResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorAnalysisResponse build() => _build();

  _$ColorAnalysisResponse _build() {
    _$ColorAnalysisResponse _$result;
    try {
      _$result =
          _$v ??
          _$ColorAnalysisResponse._(
            colorProfile: colorProfile.build(),
            disclaimer: BuiltValueNullFieldError.checkNotNull(disclaimer, r'ColorAnalysisResponse', 'disclaimer'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colorProfile';
        colorProfile.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ColorAnalysisResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
