// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitGenerateResponse extends OutfitGenerateResponse {
  @override
  final bool fallback;
  @override
  final String? message;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? occasion;
  @override
  final BuiltList<OutfitGenerateResponseOutfitsInner> outfits;
  @override
  final int wardrobeItemCount;
  @override
  final OutfitGenerateResponseWeatherUsed weatherUsed;

  factory _$OutfitGenerateResponse([void Function(OutfitGenerateResponseBuilder)? updates]) =>
      (OutfitGenerateResponseBuilder()..update(updates))._build();

  _$OutfitGenerateResponse._({
    required this.fallback,
    this.message,
    this.occasion,
    required this.outfits,
    required this.wardrobeItemCount,
    required this.weatherUsed,
  }) : super._();
  @override
  OutfitGenerateResponse rebuild(void Function(OutfitGenerateResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitGenerateResponseBuilder toBuilder() => OutfitGenerateResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitGenerateResponse &&
        fallback == other.fallback &&
        message == other.message &&
        occasion == other.occasion &&
        outfits == other.outfits &&
        wardrobeItemCount == other.wardrobeItemCount &&
        weatherUsed == other.weatherUsed;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, fallback.hashCode);
    _$hash = $jc(_$hash, message.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, outfits.hashCode);
    _$hash = $jc(_$hash, wardrobeItemCount.hashCode);
    _$hash = $jc(_$hash, weatherUsed.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitGenerateResponse')
          ..add('fallback', fallback)
          ..add('message', message)
          ..add('occasion', occasion)
          ..add('outfits', outfits)
          ..add('wardrobeItemCount', wardrobeItemCount)
          ..add('weatherUsed', weatherUsed))
        .toString();
  }
}

class OutfitGenerateResponseBuilder implements Builder<OutfitGenerateResponse, OutfitGenerateResponseBuilder> {
  _$OutfitGenerateResponse? _$v;

  bool? _fallback;
  bool? get fallback => _$this._fallback;
  set fallback(bool? fallback) => _$this._fallback = fallback;

  String? _message;
  String? get message => _$this._message;
  set message(String? message) => _$this._message = message;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _occasion;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get occasion =>
      _$this._occasion ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set occasion(ColorAnalysisResponseColorProfileContrastLevelBuilder? occasion) => _$this._occasion = occasion;

  ListBuilder<OutfitGenerateResponseOutfitsInner>? _outfits;
  ListBuilder<OutfitGenerateResponseOutfitsInner> get outfits =>
      _$this._outfits ??= ListBuilder<OutfitGenerateResponseOutfitsInner>();
  set outfits(ListBuilder<OutfitGenerateResponseOutfitsInner>? outfits) => _$this._outfits = outfits;

  int? _wardrobeItemCount;
  int? get wardrobeItemCount => _$this._wardrobeItemCount;
  set wardrobeItemCount(int? wardrobeItemCount) => _$this._wardrobeItemCount = wardrobeItemCount;

  OutfitGenerateResponseWeatherUsedBuilder? _weatherUsed;
  OutfitGenerateResponseWeatherUsedBuilder get weatherUsed =>
      _$this._weatherUsed ??= OutfitGenerateResponseWeatherUsedBuilder();
  set weatherUsed(OutfitGenerateResponseWeatherUsedBuilder? weatherUsed) => _$this._weatherUsed = weatherUsed;

  OutfitGenerateResponseBuilder() {
    OutfitGenerateResponse._defaults(this);
  }

  OutfitGenerateResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _fallback = $v.fallback;
      _message = $v.message;
      _occasion = $v.occasion?.toBuilder();
      _outfits = $v.outfits.toBuilder();
      _wardrobeItemCount = $v.wardrobeItemCount;
      _weatherUsed = $v.weatherUsed.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitGenerateResponse other) {
    _$v = other as _$OutfitGenerateResponse;
  }

  @override
  void update(void Function(OutfitGenerateResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitGenerateResponse build() => _build();

  _$OutfitGenerateResponse _build() {
    _$OutfitGenerateResponse _$result;
    try {
      _$result =
          _$v ??
          _$OutfitGenerateResponse._(
            fallback: BuiltValueNullFieldError.checkNotNull(fallback, r'OutfitGenerateResponse', 'fallback'),
            message: message,
            occasion: _occasion?.build(),
            outfits: outfits.build(),
            wardrobeItemCount: BuiltValueNullFieldError.checkNotNull(
              wardrobeItemCount,
              r'OutfitGenerateResponse',
              'wardrobeItemCount',
            ),
            weatherUsed: weatherUsed.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'occasion';
        _occasion?.build();
        _$failedField = 'outfits';
        outfits.build();

        _$failedField = 'weatherUsed';
        weatherUsed.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitGenerateResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
