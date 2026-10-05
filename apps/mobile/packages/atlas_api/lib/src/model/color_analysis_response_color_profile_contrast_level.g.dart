// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_analysis_response_color_profile_contrast_level.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ColorAnalysisResponseColorProfileContrastLevel extends ColorAnalysisResponseColorProfileContrastLevel {
  @override
  final AnyOf anyOf;

  factory _$ColorAnalysisResponseColorProfileContrastLevel([
    void Function(ColorAnalysisResponseColorProfileContrastLevelBuilder)? updates,
  ]) => (ColorAnalysisResponseColorProfileContrastLevelBuilder()..update(updates))._build();

  _$ColorAnalysisResponseColorProfileContrastLevel._({required this.anyOf}) : super._();
  @override
  ColorAnalysisResponseColorProfileContrastLevel rebuild(
    void Function(ColorAnalysisResponseColorProfileContrastLevelBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  ColorAnalysisResponseColorProfileContrastLevelBuilder toBuilder() =>
      ColorAnalysisResponseColorProfileContrastLevelBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorAnalysisResponseColorProfileContrastLevel && anyOf == other.anyOf;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, anyOf.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(
      r'ColorAnalysisResponseColorProfileContrastLevel',
    )..add('anyOf', anyOf)).toString();
  }
}

class ColorAnalysisResponseColorProfileContrastLevelBuilder
    implements
        Builder<ColorAnalysisResponseColorProfileContrastLevel, ColorAnalysisResponseColorProfileContrastLevelBuilder> {
  _$ColorAnalysisResponseColorProfileContrastLevel? _$v;

  AnyOf? _anyOf;
  AnyOf? get anyOf => _$this._anyOf;
  set anyOf(AnyOf? anyOf) => _$this._anyOf = anyOf;

  ColorAnalysisResponseColorProfileContrastLevelBuilder() {
    ColorAnalysisResponseColorProfileContrastLevel._defaults(this);
  }

  ColorAnalysisResponseColorProfileContrastLevelBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _anyOf = $v.anyOf;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorAnalysisResponseColorProfileContrastLevel other) {
    _$v = other as _$ColorAnalysisResponseColorProfileContrastLevel;
  }

  @override
  void update(void Function(ColorAnalysisResponseColorProfileContrastLevelBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorAnalysisResponseColorProfileContrastLevel build() => _build();

  _$ColorAnalysisResponseColorProfileContrastLevel _build() {
    final _$result =
        _$v ??
        _$ColorAnalysisResponseColorProfileContrastLevel._(
          anyOf: BuiltValueNullFieldError.checkNotNull(
            anyOf,
            r'ColorAnalysisResponseColorProfileContrastLevel',
            'anyOf',
          ),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
