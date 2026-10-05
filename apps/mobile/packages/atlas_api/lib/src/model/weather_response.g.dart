// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'weather_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WeatherResponse extends WeatherResponse {
  @override
  final WeatherResponseWeather weather;

  factory _$WeatherResponse([void Function(WeatherResponseBuilder)? updates]) =>
      (WeatherResponseBuilder()..update(updates))._build();

  _$WeatherResponse._({required this.weather}) : super._();
  @override
  WeatherResponse rebuild(void Function(WeatherResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  WeatherResponseBuilder toBuilder() => WeatherResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WeatherResponse && weather == other.weather;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, weather.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WeatherResponse')..add('weather', weather)).toString();
  }
}

class WeatherResponseBuilder implements Builder<WeatherResponse, WeatherResponseBuilder> {
  _$WeatherResponse? _$v;

  WeatherResponseWeatherBuilder? _weather;
  WeatherResponseWeatherBuilder get weather => _$this._weather ??= WeatherResponseWeatherBuilder();
  set weather(WeatherResponseWeatherBuilder? weather) => _$this._weather = weather;

  WeatherResponseBuilder() {
    WeatherResponse._defaults(this);
  }

  WeatherResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _weather = $v.weather.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WeatherResponse other) {
    _$v = other as _$WeatherResponse;
  }

  @override
  void update(void Function(WeatherResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WeatherResponse build() => _build();

  _$WeatherResponse _build() {
    _$WeatherResponse _$result;
    try {
      _$result = _$v ?? _$WeatherResponse._(weather: weather.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'weather';
        weather.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WeatherResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
