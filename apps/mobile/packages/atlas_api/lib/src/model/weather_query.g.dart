// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'weather_query.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WeatherQuery extends WeatherQuery {
  @override
  final num lat;
  @override
  final num lon;

  factory _$WeatherQuery([void Function(WeatherQueryBuilder)? updates]) =>
      (WeatherQueryBuilder()..update(updates))._build();

  _$WeatherQuery._({required this.lat, required this.lon}) : super._();
  @override
  WeatherQuery rebuild(void Function(WeatherQueryBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  WeatherQueryBuilder toBuilder() => WeatherQueryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WeatherQuery && lat == other.lat && lon == other.lon;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, lat.hashCode);
    _$hash = $jc(_$hash, lon.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WeatherQuery')
          ..add('lat', lat)
          ..add('lon', lon))
        .toString();
  }
}

class WeatherQueryBuilder implements Builder<WeatherQuery, WeatherQueryBuilder> {
  _$WeatherQuery? _$v;

  num? _lat;
  num? get lat => _$this._lat;
  set lat(num? lat) => _$this._lat = lat;

  num? _lon;
  num? get lon => _$this._lon;
  set lon(num? lon) => _$this._lon = lon;

  WeatherQueryBuilder() {
    WeatherQuery._defaults(this);
  }

  WeatherQueryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _lat = $v.lat;
      _lon = $v.lon;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WeatherQuery other) {
    _$v = other as _$WeatherQuery;
  }

  @override
  void update(void Function(WeatherQueryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WeatherQuery build() => _build();

  _$WeatherQuery _build() {
    final _$result =
        _$v ??
        _$WeatherQuery._(
          lat: BuiltValueNullFieldError.checkNotNull(lat, r'WeatherQuery', 'lat'),
          lon: BuiltValueNullFieldError.checkNotNull(lon, r'WeatherQuery', 'lon'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
