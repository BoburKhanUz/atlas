// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_analysis_response_color_profile_secondary_confidence.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ColorAnalysisResponseColorProfileSecondaryConfidence
    extends ColorAnalysisResponseColorProfileSecondaryConfidence {
  @override
  final AnyOf anyOf;

  factory _$ColorAnalysisResponseColorProfileSecondaryConfidence([
    void Function(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder)? updates,
  ]) => (ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder()..update(updates))._build();

  _$ColorAnalysisResponseColorProfileSecondaryConfidence._({required this.anyOf}) : super._();
  @override
  ColorAnalysisResponseColorProfileSecondaryConfidence rebuild(
    void Function(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder toBuilder() =>
      ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorAnalysisResponseColorProfileSecondaryConfidence && anyOf == other.anyOf;
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
      r'ColorAnalysisResponseColorProfileSecondaryConfidence',
    )..add('anyOf', anyOf)).toString();
  }
}

class ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder
    implements
        Builder<
          ColorAnalysisResponseColorProfileSecondaryConfidence,
          ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder
        > {
  _$ColorAnalysisResponseColorProfileSecondaryConfidence? _$v;

  AnyOf? _anyOf;
  AnyOf? get anyOf => _$this._anyOf;
  set anyOf(AnyOf? anyOf) => _$this._anyOf = anyOf;

  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder() {
    ColorAnalysisResponseColorProfileSecondaryConfidence._defaults(this);
  }

  ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _anyOf = $v.anyOf;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorAnalysisResponseColorProfileSecondaryConfidence other) {
    _$v = other as _$ColorAnalysisResponseColorProfileSecondaryConfidence;
  }

  @override
  void update(void Function(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorAnalysisResponseColorProfileSecondaryConfidence build() => _build();

  _$ColorAnalysisResponseColorProfileSecondaryConfidence _build() {
    final _$result =
        _$v ??
        _$ColorAnalysisResponseColorProfileSecondaryConfidence._(
          anyOf: BuiltValueNullFieldError.checkNotNull(
            anyOf,
            r'ColorAnalysisResponseColorProfileSecondaryConfidence',
            'anyOf',
          ),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
