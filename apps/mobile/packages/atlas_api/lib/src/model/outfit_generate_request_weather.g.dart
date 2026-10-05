// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_request_weather.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitGenerateRequestWeather extends OutfitGenerateRequestWeather {
  @override
  final String condition;
  @override
  final num feelsLike;
  @override
  final num humidity;
  @override
  final num precipitationProbability;
  @override
  final num temperature;
  @override
  final num uvIndex;
  @override
  final num windSpeed;

  factory _$OutfitGenerateRequestWeather([void Function(OutfitGenerateRequestWeatherBuilder)? updates]) =>
      (OutfitGenerateRequestWeatherBuilder()..update(updates))._build();

  _$OutfitGenerateRequestWeather._({
    required this.condition,
    required this.feelsLike,
    required this.humidity,
    required this.precipitationProbability,
    required this.temperature,
    required this.uvIndex,
    required this.windSpeed,
  }) : super._();
  @override
  OutfitGenerateRequestWeather rebuild(void Function(OutfitGenerateRequestWeatherBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitGenerateRequestWeatherBuilder toBuilder() => OutfitGenerateRequestWeatherBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitGenerateRequestWeather &&
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
    return (newBuiltValueToStringHelper(r'OutfitGenerateRequestWeather')
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

class OutfitGenerateRequestWeatherBuilder
    implements Builder<OutfitGenerateRequestWeather, OutfitGenerateRequestWeatherBuilder> {
  _$OutfitGenerateRequestWeather? _$v;

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

  OutfitGenerateRequestWeatherBuilder() {
    OutfitGenerateRequestWeather._defaults(this);
  }

  OutfitGenerateRequestWeatherBuilder get _$this {
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
  void replace(OutfitGenerateRequestWeather other) {
    _$v = other as _$OutfitGenerateRequestWeather;
  }

  @override
  void update(void Function(OutfitGenerateRequestWeatherBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitGenerateRequestWeather build() => _build();

  _$OutfitGenerateRequestWeather _build() {
    final _$result =
        _$v ??
        _$OutfitGenerateRequestWeather._(
          condition: BuiltValueNullFieldError.checkNotNull(condition, r'OutfitGenerateRequestWeather', 'condition'),
          feelsLike: BuiltValueNullFieldError.checkNotNull(feelsLike, r'OutfitGenerateRequestWeather', 'feelsLike'),
          humidity: BuiltValueNullFieldError.checkNotNull(humidity, r'OutfitGenerateRequestWeather', 'humidity'),
          precipitationProbability: BuiltValueNullFieldError.checkNotNull(
            precipitationProbability,
            r'OutfitGenerateRequestWeather',
            'precipitationProbability',
          ),
          temperature: BuiltValueNullFieldError.checkNotNull(
            temperature,
            r'OutfitGenerateRequestWeather',
            'temperature',
          ),
          uvIndex: BuiltValueNullFieldError.checkNotNull(uvIndex, r'OutfitGenerateRequestWeather', 'uvIndex'),
          windSpeed: BuiltValueNullFieldError.checkNotNull(windSpeed, r'OutfitGenerateRequestWeather', 'windSpeed'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
