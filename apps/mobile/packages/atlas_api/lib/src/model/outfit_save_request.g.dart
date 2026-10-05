// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_save_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_work = const OutfitSaveRequestOccasionEnum._(
  'work',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_wedding = const OutfitSaveRequestOccasionEnum._(
  'wedding',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_date = const OutfitSaveRequestOccasionEnum._(
  'date',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_travel = const OutfitSaveRequestOccasionEnum._(
  'travel',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_casual = const OutfitSaveRequestOccasionEnum._(
  'casual',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_other = const OutfitSaveRequestOccasionEnum._(
  'other',
);
const OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnum_unknownDefaultOpenApi =
    const OutfitSaveRequestOccasionEnum._('unknownDefaultOpenApi');

OutfitSaveRequestOccasionEnum _$outfitSaveRequestOccasionEnumValueOf(String name) {
  switch (name) {
    case 'work':
      return _$outfitSaveRequestOccasionEnum_work;
    case 'wedding':
      return _$outfitSaveRequestOccasionEnum_wedding;
    case 'date':
      return _$outfitSaveRequestOccasionEnum_date;
    case 'travel':
      return _$outfitSaveRequestOccasionEnum_travel;
    case 'casual':
      return _$outfitSaveRequestOccasionEnum_casual;
    case 'other':
      return _$outfitSaveRequestOccasionEnum_other;
    case 'unknownDefaultOpenApi':
      return _$outfitSaveRequestOccasionEnum_unknownDefaultOpenApi;
    default:
      return _$outfitSaveRequestOccasionEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitSaveRequestOccasionEnum> _$outfitSaveRequestOccasionEnumValues =
    BuiltSet<OutfitSaveRequestOccasionEnum>(const <OutfitSaveRequestOccasionEnum>[
      _$outfitSaveRequestOccasionEnum_work,
      _$outfitSaveRequestOccasionEnum_wedding,
      _$outfitSaveRequestOccasionEnum_date,
      _$outfitSaveRequestOccasionEnum_travel,
      _$outfitSaveRequestOccasionEnum_casual,
      _$outfitSaveRequestOccasionEnum_other,
      _$outfitSaveRequestOccasionEnum_unknownDefaultOpenApi,
    ]);

Serializer<OutfitSaveRequestOccasionEnum> _$outfitSaveRequestOccasionEnumSerializer =
    _$OutfitSaveRequestOccasionEnumSerializer();

class _$OutfitSaveRequestOccasionEnumSerializer implements PrimitiveSerializer<OutfitSaveRequestOccasionEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'work': 'work',
    'wedding': 'wedding',
    'date': 'date',
    'travel': 'travel',
    'casual': 'casual',
    'other': 'other',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'work': 'work',
    'wedding': 'wedding',
    'date': 'date',
    'travel': 'travel',
    'casual': 'casual',
    'other': 'other',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[OutfitSaveRequestOccasionEnum];
  @override
  final String wireName = 'OutfitSaveRequestOccasionEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitSaveRequestOccasionEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitSaveRequestOccasionEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitSaveRequestOccasionEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$OutfitSaveRequest extends OutfitSaveRequest {
  @override
  final String? explanation;
  @override
  final bool? isSaved;
  @override
  final BuiltList<OutfitSaveRequestItemsInner> items;
  @override
  final String? name;
  @override
  final OutfitSaveRequestOccasionEnum? occasion;
  @override
  final BuiltList<String>? reasons;
  @override
  final num? score;
  @override
  final OutfitGenerateRequestWeather? weather;

  factory _$OutfitSaveRequest([void Function(OutfitSaveRequestBuilder)? updates]) =>
      (OutfitSaveRequestBuilder()..update(updates))._build();

  _$OutfitSaveRequest._({
    this.explanation,
    this.isSaved,
    required this.items,
    this.name,
    this.occasion,
    this.reasons,
    this.score,
    this.weather,
  }) : super._();
  @override
  OutfitSaveRequest rebuild(void Function(OutfitSaveRequestBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitSaveRequestBuilder toBuilder() => OutfitSaveRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSaveRequest &&
        explanation == other.explanation &&
        isSaved == other.isSaved &&
        items == other.items &&
        name == other.name &&
        occasion == other.occasion &&
        reasons == other.reasons &&
        score == other.score &&
        weather == other.weather;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, explanation.hashCode);
    _$hash = $jc(_$hash, isSaved.hashCode);
    _$hash = $jc(_$hash, items.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, reasons.hashCode);
    _$hash = $jc(_$hash, score.hashCode);
    _$hash = $jc(_$hash, weather.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSaveRequest')
          ..add('explanation', explanation)
          ..add('isSaved', isSaved)
          ..add('items', items)
          ..add('name', name)
          ..add('occasion', occasion)
          ..add('reasons', reasons)
          ..add('score', score)
          ..add('weather', weather))
        .toString();
  }
}

class OutfitSaveRequestBuilder implements Builder<OutfitSaveRequest, OutfitSaveRequestBuilder> {
  _$OutfitSaveRequest? _$v;

  String? _explanation;
  String? get explanation => _$this._explanation;
  set explanation(String? explanation) => _$this._explanation = explanation;

  bool? _isSaved;
  bool? get isSaved => _$this._isSaved;
  set isSaved(bool? isSaved) => _$this._isSaved = isSaved;

  ListBuilder<OutfitSaveRequestItemsInner>? _items;
  ListBuilder<OutfitSaveRequestItemsInner> get items => _$this._items ??= ListBuilder<OutfitSaveRequestItemsInner>();
  set items(ListBuilder<OutfitSaveRequestItemsInner>? items) => _$this._items = items;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  OutfitSaveRequestOccasionEnum? _occasion;
  OutfitSaveRequestOccasionEnum? get occasion => _$this._occasion;
  set occasion(OutfitSaveRequestOccasionEnum? occasion) => _$this._occasion = occasion;

  ListBuilder<String>? _reasons;
  ListBuilder<String> get reasons => _$this._reasons ??= ListBuilder<String>();
  set reasons(ListBuilder<String>? reasons) => _$this._reasons = reasons;

  num? _score;
  num? get score => _$this._score;
  set score(num? score) => _$this._score = score;

  OutfitGenerateRequestWeatherBuilder? _weather;
  OutfitGenerateRequestWeatherBuilder get weather => _$this._weather ??= OutfitGenerateRequestWeatherBuilder();
  set weather(OutfitGenerateRequestWeatherBuilder? weather) => _$this._weather = weather;

  OutfitSaveRequestBuilder() {
    OutfitSaveRequest._defaults(this);
  }

  OutfitSaveRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _explanation = $v.explanation;
      _isSaved = $v.isSaved;
      _items = $v.items.toBuilder();
      _name = $v.name;
      _occasion = $v.occasion;
      _reasons = $v.reasons?.toBuilder();
      _score = $v.score;
      _weather = $v.weather?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSaveRequest other) {
    _$v = other as _$OutfitSaveRequest;
  }

  @override
  void update(void Function(OutfitSaveRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSaveRequest build() => _build();

  _$OutfitSaveRequest _build() {
    _$OutfitSaveRequest _$result;
    try {
      _$result =
          _$v ??
          _$OutfitSaveRequest._(
            explanation: explanation,
            isSaved: isSaved,
            items: items.build(),
            name: name,
            occasion: occasion,
            reasons: _reasons?.build(),
            score: score,
            weather: _weather?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'items';
        items.build();

        _$failedField = 'reasons';
        _reasons?.build();

        _$failedField = 'weather';
        _weather?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitSaveRequest', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
