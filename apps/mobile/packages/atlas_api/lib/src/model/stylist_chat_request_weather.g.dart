// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'stylist_chat_request_weather.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$StylistChatRequestWeather extends StylistChatRequestWeather {
  @override
  final String? condition;
  @override
  final num? feelsLike;
  @override
  final num? humidity;
  @override
  final num? precipitationProbability;
  @override
  final num? temperature;
  @override
  final num? uvIndex;
  @override
  final num? windSpeed;

  factory _$StylistChatRequestWeather([void Function(StylistChatRequestWeatherBuilder)? updates]) =>
      (StylistChatRequestWeatherBuilder()..update(updates))._build();

  _$StylistChatRequestWeather._({
    this.condition,
    this.feelsLike,
    this.humidity,
    this.precipitationProbability,
    this.temperature,
    this.uvIndex,
    this.windSpeed,
  }) : super._();
  @override
  StylistChatRequestWeather rebuild(void Function(StylistChatRequestWeatherBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  StylistChatRequestWeatherBuilder toBuilder() => StylistChatRequestWeatherBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is StylistChatRequestWeather &&
        condition == other.condition &&
        feelsLike == other.feelsLike &&
        humidity == other.humidity &&
        precipitationProbability == other.precipitationProbability &&
        temperature == other.temperature &&
        uvIndex == other.uvIndex &&
        windSpeed == other.windSpeed;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, condition.hashCode);
    _$hash = $jc(_$hash, feelsLike.hashCode);
    _$hash = $jc(_$hash, humidity.hashCode);
    _$hash = $jc(_$hash, precipitationProbability.hashCode);
    _$hash = $jc(_$hash, temperature.hashCode);
    _$hash = $jc(_$hash, uvIndex.hashCode);
    _$hash = $jc(_$hash, windSpeed.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'StylistChatRequestWeather')
          ..add('condition', condition)
          ..add('feelsLike', feelsLike)
          ..add('humidity', humidity)
          ..add('precipitationProbability', precipitationProbability)
          ..add('temperature', temperature)
          ..add('uvIndex', uvIndex)
          ..add('windSpeed', windSpeed))
        .toString();
  }
}

class StylistChatRequestWeatherBuilder implements Builder<StylistChatRequestWeather, StylistChatRequestWeatherBuilder> {
  _$StylistChatRequestWeather? _$v;

  String? _condition;
  String? get condition => _$this._condition;
  set condition(String? condition) => _$this._condition = condition;

  num? _feelsLike;
  num? get feelsLike => _$this._feelsLike;
  set feelsLike(num? feelsLike) => _$this._feelsLike = feelsLike;

  num? _humidity;
  num? get humidity => _$this._humidity;
  set humidity(num? humidity) => _$this._humidity = humidity;

  num? _precipitationProbability;
  num? get precipitationProbability => _$this._precipitationProbability;
  set precipitationProbability(num? precipitationProbability) =>
      _$this._precipitationProbability = precipitationProbability;

  num? _temperature;
  num? get temperature => _$this._temperature;
  set temperature(num? temperature) => _$this._temperature = temperature;

  num? _uvIndex;
  num? get uvIndex => _$this._uvIndex;
  set uvIndex(num? uvIndex) => _$this._uvIndex = uvIndex;

  num? _windSpeed;
  num? get windSpeed => _$this._windSpeed;
  set windSpeed(num? windSpeed) => _$this._windSpeed = windSpeed;

  StylistChatRequestWeatherBuilder() {
    StylistChatRequestWeather._defaults(this);
  }

  StylistChatRequestWeatherBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _condition = $v.condition;
      _feelsLike = $v.feelsLike;
      _humidity = $v.humidity;
      _precipitationProbability = $v.precipitationProbability;
      _temperature = $v.temperature;
      _uvIndex = $v.uvIndex;
      _windSpeed = $v.windSpeed;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(StylistChatRequestWeather other) {
    _$v = other as _$StylistChatRequestWeather;
  }

  @override
  void update(void Function(StylistChatRequestWeatherBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  StylistChatRequestWeather build() => _build();

  _$StylistChatRequestWeather _build() {
    final _$result =
        _$v ??
        _$StylistChatRequestWeather._(
          condition: condition,
          feelsLike: feelsLike,
          humidity: humidity,
          precipitationProbability: precipitationProbability,
          temperature: temperature,
          uvIndex: uvIndex,
          windSpeed: windSpeed,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
