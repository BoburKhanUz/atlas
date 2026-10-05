// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_response_outfits_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitGenerateResponseOutfitsInnerContrastLevelEnum _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_low =
    const OutfitGenerateResponseOutfitsInnerContrastLevelEnum._('low');
const OutfitGenerateResponseOutfitsInnerContrastLevelEnum _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_medium =
    const OutfitGenerateResponseOutfitsInnerContrastLevelEnum._('medium');
const OutfitGenerateResponseOutfitsInnerContrastLevelEnum _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_high =
    const OutfitGenerateResponseOutfitsInnerContrastLevelEnum._('high');
const OutfitGenerateResponseOutfitsInnerContrastLevelEnum
_$outfitGenerateResponseOutfitsInnerContrastLevelEnum_unknownDefaultOpenApi =
    const OutfitGenerateResponseOutfitsInnerContrastLevelEnum._('unknownDefaultOpenApi');

OutfitGenerateResponseOutfitsInnerContrastLevelEnum _$outfitGenerateResponseOutfitsInnerContrastLevelEnumValueOf(
  String name,
) {
  switch (name) {
    case 'low':
      return _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_low;
    case 'medium':
      return _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_medium;
    case 'high':
      return _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_high;
    case 'unknownDefaultOpenApi':
      return _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_unknownDefaultOpenApi;
    default:
      return _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitGenerateResponseOutfitsInnerContrastLevelEnum>
_$outfitGenerateResponseOutfitsInnerContrastLevelEnumValues =
    BuiltSet<OutfitGenerateResponseOutfitsInnerContrastLevelEnum>(
      const <OutfitGenerateResponseOutfitsInnerContrastLevelEnum>[
        _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_low,
        _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_medium,
        _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_high,
        _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_unknownDefaultOpenApi,
      ],
    );

Serializer<OutfitGenerateResponseOutfitsInnerContrastLevelEnum>
_$outfitGenerateResponseOutfitsInnerContrastLevelEnumSerializer =
    _$OutfitGenerateResponseOutfitsInnerContrastLevelEnumSerializer();

class _$OutfitGenerateResponseOutfitsInnerContrastLevelEnumSerializer
    implements PrimitiveSerializer<OutfitGenerateResponseOutfitsInnerContrastLevelEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'low': 'low',
    'medium': 'medium',
    'high': 'high',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'low': 'low',
    'medium': 'medium',
    'high': 'high',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[OutfitGenerateResponseOutfitsInnerContrastLevelEnum];
  @override
  final String wireName = 'OutfitGenerateResponseOutfitsInnerContrastLevelEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInnerContrastLevelEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitGenerateResponseOutfitsInnerContrastLevelEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitGenerateResponseOutfitsInnerContrastLevelEnum.valueOf(
    _fromWire[serialized] ?? (serialized is String ? serialized : ''),
  );
}

class _$OutfitGenerateResponseOutfitsInner extends OutfitGenerateResponseOutfitsInner {
  @override
  final OutfitGenerateResponseOutfitsInnerContrastLevelEnum contrastLevel;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? explanation;
  @override
  final OutfitGenerateResponseOutfitsInnerFactors factors;
  @override
  final BuiltList<OutfitGenerateResponseOutfitsInnerItemsInner> items;
  @override
  final BuiltList<String> reasons;
  @override
  final num score;
  @override
  final String tempId;

  factory _$OutfitGenerateResponseOutfitsInner([void Function(OutfitGenerateResponseOutfitsInnerBuilder)? updates]) =>
      (OutfitGenerateResponseOutfitsInnerBuilder()..update(updates))._build();

  _$OutfitGenerateResponseOutfitsInner._({
    required this.contrastLevel,
    this.explanation,
    required this.factors,
    required this.items,
    required this.reasons,
    required this.score,
    required this.tempId,
  }) : super._();
  @override
  OutfitGenerateResponseOutfitsInner rebuild(void Function(OutfitGenerateResponseOutfitsInnerBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitGenerateResponseOutfitsInnerBuilder toBuilder() => OutfitGenerateResponseOutfitsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitGenerateResponseOutfitsInner &&
        contrastLevel == other.contrastLevel &&
        explanation == other.explanation &&
        factors == other.factors &&
        items == other.items &&
        reasons == other.reasons &&
        score == other.score &&
        tempId == other.tempId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, contrastLevel.hashCode);
    _$hash = $jc(_$hash, explanation.hashCode);
    _$hash = $jc(_$hash, factors.hashCode);
    _$hash = $jc(_$hash, items.hashCode);
    _$hash = $jc(_$hash, reasons.hashCode);
    _$hash = $jc(_$hash, score.hashCode);
    _$hash = $jc(_$hash, tempId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitGenerateResponseOutfitsInner')
          ..add('contrastLevel', contrastLevel)
          ..add('explanation', explanation)
          ..add('factors', factors)
          ..add('items', items)
          ..add('reasons', reasons)
          ..add('score', score)
          ..add('tempId', tempId))
        .toString();
  }
}

class OutfitGenerateResponseOutfitsInnerBuilder
    implements Builder<OutfitGenerateResponseOutfitsInner, OutfitGenerateResponseOutfitsInnerBuilder> {
  _$OutfitGenerateResponseOutfitsInner? _$v;

  OutfitGenerateResponseOutfitsInnerContrastLevelEnum? _contrastLevel;
  OutfitGenerateResponseOutfitsInnerContrastLevelEnum? get contrastLevel => _$this._contrastLevel;
  set contrastLevel(OutfitGenerateResponseOutfitsInnerContrastLevelEnum? contrastLevel) =>
      _$this._contrastLevel = contrastLevel;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _explanation;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get explanation =>
      _$this._explanation ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set explanation(ColorAnalysisResponseColorProfileContrastLevelBuilder? explanation) =>
      _$this._explanation = explanation;

  OutfitGenerateResponseOutfitsInnerFactorsBuilder? _factors;
  OutfitGenerateResponseOutfitsInnerFactorsBuilder get factors =>
      _$this._factors ??= OutfitGenerateResponseOutfitsInnerFactorsBuilder();
  set factors(OutfitGenerateResponseOutfitsInnerFactorsBuilder? factors) => _$this._factors = factors;

  ListBuilder<OutfitGenerateResponseOutfitsInnerItemsInner>? _items;
  ListBuilder<OutfitGenerateResponseOutfitsInnerItemsInner> get items =>
      _$this._items ??= ListBuilder<OutfitGenerateResponseOutfitsInnerItemsInner>();
  set items(ListBuilder<OutfitGenerateResponseOutfitsInnerItemsInner>? items) => _$this._items = items;

  ListBuilder<String>? _reasons;
  ListBuilder<String> get reasons => _$this._reasons ??= ListBuilder<String>();
  set reasons(ListBuilder<String>? reasons) => _$this._reasons = reasons;

  num? _score;
  num? get score => _$this._score;
  set score(num? score) => _$this._score = score;

  String? _tempId;
  String? get tempId => _$this._tempId;
  set tempId(String? tempId) => _$this._tempId = tempId;

  OutfitGenerateResponseOutfitsInnerBuilder() {
    OutfitGenerateResponseOutfitsInner._defaults(this);
  }

  OutfitGenerateResponseOutfitsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _contrastLevel = $v.contrastLevel;
      _explanation = $v.explanation?.toBuilder();
      _factors = $v.factors.toBuilder();
      _items = $v.items.toBuilder();
      _reasons = $v.reasons.toBuilder();
      _score = $v.score;
      _tempId = $v.tempId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitGenerateResponseOutfitsInner other) {
    _$v = other as _$OutfitGenerateResponseOutfitsInner;
  }

  @override
  void update(void Function(OutfitGenerateResponseOutfitsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitGenerateResponseOutfitsInner build() => _build();

  _$OutfitGenerateResponseOutfitsInner _build() {
    _$OutfitGenerateResponseOutfitsInner _$result;
    try {
      _$result =
          _$v ??
          _$OutfitGenerateResponseOutfitsInner._(
            contrastLevel: BuiltValueNullFieldError.checkNotNull(
              contrastLevel,
              r'OutfitGenerateResponseOutfitsInner',
              'contrastLevel',
            ),
            explanation: _explanation?.build(),
            factors: factors.build(),
            items: items.build(),
            reasons: reasons.build(),
            score: BuiltValueNullFieldError.checkNotNull(score, r'OutfitGenerateResponseOutfitsInner', 'score'),
            tempId: BuiltValueNullFieldError.checkNotNull(tempId, r'OutfitGenerateResponseOutfitsInner', 'tempId'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'explanation';
        _explanation?.build();
        _$failedField = 'factors';
        factors.build();
        _$failedField = 'items';
        items.build();
        _$failedField = 'reasons';
        reasons.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitGenerateResponseOutfitsInner', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
