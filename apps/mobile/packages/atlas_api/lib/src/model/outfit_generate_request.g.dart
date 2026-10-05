// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_work =
    const OutfitGenerateRequestOccasionEnum._('work');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_wedding =
    const OutfitGenerateRequestOccasionEnum._('wedding');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_date =
    const OutfitGenerateRequestOccasionEnum._('date');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_travel =
    const OutfitGenerateRequestOccasionEnum._('travel');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_casual =
    const OutfitGenerateRequestOccasionEnum._('casual');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_other =
    const OutfitGenerateRequestOccasionEnum._('other');
const OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnum_unknownDefaultOpenApi =
    const OutfitGenerateRequestOccasionEnum._('unknownDefaultOpenApi');

OutfitGenerateRequestOccasionEnum _$outfitGenerateRequestOccasionEnumValueOf(String name) {
  switch (name) {
    case 'work':
      return _$outfitGenerateRequestOccasionEnum_work;
    case 'wedding':
      return _$outfitGenerateRequestOccasionEnum_wedding;
    case 'date':
      return _$outfitGenerateRequestOccasionEnum_date;
    case 'travel':
      return _$outfitGenerateRequestOccasionEnum_travel;
    case 'casual':
      return _$outfitGenerateRequestOccasionEnum_casual;
    case 'other':
      return _$outfitGenerateRequestOccasionEnum_other;
    case 'unknownDefaultOpenApi':
      return _$outfitGenerateRequestOccasionEnum_unknownDefaultOpenApi;
    default:
      return _$outfitGenerateRequestOccasionEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitGenerateRequestOccasionEnum> _$outfitGenerateRequestOccasionEnumValues =
    BuiltSet<OutfitGenerateRequestOccasionEnum>(const <OutfitGenerateRequestOccasionEnum>[
      _$outfitGenerateRequestOccasionEnum_work,
      _$outfitGenerateRequestOccasionEnum_wedding,
      _$outfitGenerateRequestOccasionEnum_date,
      _$outfitGenerateRequestOccasionEnum_travel,
      _$outfitGenerateRequestOccasionEnum_casual,
      _$outfitGenerateRequestOccasionEnum_other,
      _$outfitGenerateRequestOccasionEnum_unknownDefaultOpenApi,
    ]);

Serializer<OutfitGenerateRequestOccasionEnum> _$outfitGenerateRequestOccasionEnumSerializer =
    _$OutfitGenerateRequestOccasionEnumSerializer();

class _$OutfitGenerateRequestOccasionEnumSerializer implements PrimitiveSerializer<OutfitGenerateRequestOccasionEnum> {
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
  final Iterable<Type> types = const <Type>[OutfitGenerateRequestOccasionEnum];
  @override
  final String wireName = 'OutfitGenerateRequestOccasionEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateRequestOccasionEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitGenerateRequestOccasionEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitGenerateRequestOccasionEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$OutfitGenerateRequest extends OutfitGenerateRequest {
  @override
  final num? lat;
  @override
  final num? lon;
  @override
  final OutfitGenerateRequestOccasionEnum? occasion;
  @override
  final num? seed;
  @override
  final int? topN;
  @override
  final OutfitGenerateRequestWeather? weather;

  factory _$OutfitGenerateRequest([void Function(OutfitGenerateRequestBuilder)? updates]) =>
      (OutfitGenerateRequestBuilder()..update(updates))._build();

  _$OutfitGenerateRequest._({this.lat, this.lon, this.occasion, this.seed, this.topN, this.weather}) : super._();
  @override
  OutfitGenerateRequest rebuild(void Function(OutfitGenerateRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitGenerateRequestBuilder toBuilder() => OutfitGenerateRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitGenerateRequest &&
        lat == other.lat &&
        lon == other.lon &&
        occasion == other.occasion &&
        seed == other.seed &&
        topN == other.topN &&
        weather == other.weather;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, lat.hashCode);
    _$hash = $jc(_$hash, lon.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, seed.hashCode);
    _$hash = $jc(_$hash, topN.hashCode);
    _$hash = $jc(_$hash, weather.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitGenerateRequest')
          ..add('lat', lat)
          ..add('lon', lon)
          ..add('occasion', occasion)
          ..add('seed', seed)
          ..add('topN', topN)
          ..add('weather', weather))
        .toString();
  }
}

class OutfitGenerateRequestBuilder implements Builder<OutfitGenerateRequest, OutfitGenerateRequestBuilder> {
  _$OutfitGenerateRequest? _$v;

  num? _lat;
  num? get lat => _$this._lat;
  set lat(num? lat) => _$this._lat = lat;

  num? _lon;
  num? get lon => _$this._lon;
  set lon(num? lon) => _$this._lon = lon;

  OutfitGenerateRequestOccasionEnum? _occasion;
  OutfitGenerateRequestOccasionEnum? get occasion => _$this._occasion;
  set occasion(OutfitGenerateRequestOccasionEnum? occasion) => _$this._occasion = occasion;

  num? _seed;
  num? get seed => _$this._seed;
  set seed(num? seed) => _$this._seed = seed;

  int? _topN;
  int? get topN => _$this._topN;
  set topN(int? topN) => _$this._topN = topN;

  OutfitGenerateRequestWeatherBuilder? _weather;
  OutfitGenerateRequestWeatherBuilder get weather => _$this._weather ??= OutfitGenerateRequestWeatherBuilder();
  set weather(OutfitGenerateRequestWeatherBuilder? weather) => _$this._weather = weather;

  OutfitGenerateRequestBuilder() {
    OutfitGenerateRequest._defaults(this);
  }

  OutfitGenerateRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _lat = $v.lat;
      _lon = $v.lon;
      _occasion = $v.occasion;
      _seed = $v.seed;
      _topN = $v.topN;
      _weather = $v.weather?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitGenerateRequest other) {
    _$v = other as _$OutfitGenerateRequest;
  }

  @override
  void update(void Function(OutfitGenerateRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitGenerateRequest build() => _build();

  _$OutfitGenerateRequest _build() {
    _$OutfitGenerateRequest _$result;
    try {
      _$result =
          _$v ??
          _$OutfitGenerateRequest._(
            lat: lat,
            lon: lon,
            occasion: occasion,
            seed: seed,
            topN: topN,
            weather: _weather?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'weather';
        _weather?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitGenerateRequest', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
