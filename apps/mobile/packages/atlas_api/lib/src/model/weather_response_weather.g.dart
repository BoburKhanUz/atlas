// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'weather_response_weather.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WeatherResponseWeather extends WeatherResponseWeather {
  @override
  final bool cached;
  @override
  final String condition;
  @override
  final String conditionLabel;
  @override
  final num feelsLike;
  @override
  final DateTime fetchedAt;
  @override
  final num humidity;
  @override
  final num precipitationAmount;
  @override
  final num precipitationProbability;
  @override
  final String source_;
  @override
  final num temperature;
  @override
  final num uvIndex;
  @override
  final num windSpeed;

  factory _$WeatherResponseWeather([void Function(WeatherResponseWeatherBuilder)? updates]) =>
      (WeatherResponseWeatherBuilder()..update(updates))._build();

  _$WeatherResponseWeather._({
    required this.cached,
    required this.condition,
    required this.conditionLabel,
    required this.feelsLike,
    required this.fetchedAt,
    required this.humidity,
    required this.precipitationAmount,
    required this.precipitationProbability,
    required this.source_,
    required this.temperature,
    required this.uvIndex,
    required this.windSpeed,
  }) : super._();
  @override
  WeatherResponseWeather rebuild(void Function(WeatherResponseWeatherBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  WeatherResponseWeatherBuilder toBuilder() => WeatherResponseWeatherBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WeatherResponseWeather &&
        cached == other.cached &&
        condition == other.condition &&
        conditionLabel == other.conditionLabel &&
        feelsLike == other.feelsLike &&
        fetchedAt == other.fetchedAt &&
        humidity == other.humidity &&
        precipitationAmount == other.precipitationAmount &&
        precipitationProbability == other.precipitationProbability &&
        source_ == other.source_ &&
        temperature == other.temperature &&
        uvIndex == other.uvIndex &&
        windSpeed == other.windSpeed;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, cached.hashCode);
    _$hash = $jc(_$hash, condition.hashCode);
    _$hash = $jc(_$hash, conditionLabel.hashCode);
    _$hash = $jc(_$hash, feelsLike.hashCode);
    _$hash = $jc(_$hash, fetchedAt.hashCode);
    _$hash = $jc(_$hash, humidity.hashCode);
    _$hash = $jc(_$hash, precipitationAmount.hashCode);
    _$hash = $jc(_$hash, precipitationProbability.hashCode);
    _$hash = $jc(_$hash, source_.hashCode);
    _$hash = $jc(_$hash, temperature.hashCode);
    _$hash = $jc(_$hash, uvIndex.hashCode);
    _$hash = $jc(_$hash, windSpeed.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WeatherResponseWeather')
          ..add('cached', cached)
          ..add('condition', condition)
          ..add('conditionLabel', conditionLabel)
          ..add('feelsLike', feelsLike)
          ..add('fetchedAt', fetchedAt)
          ..add('humidity', humidity)
          ..add('precipitationAmount', precipitationAmount)
          ..add('precipitationProbability', precipitationProbability)
          ..add('source_', source_)
          ..add('temperature', temperature)
          ..add('uvIndex', uvIndex)
          ..add('windSpeed', windSpeed))
        .toString();
  }
}

class WeatherResponseWeatherBuilder implements Builder<WeatherResponseWeather, WeatherResponseWeatherBuilder> {
  _$WeatherResponseWeather? _$v;

  bool? _cached;
  bool? get cached => _$this._cached;
  set cached(bool? cached) => _$this._cached = cached;

  String? _condition;
  String? get condition => _$this._condition;
  set condition(String? condition) => _$this._condition = condition;

  String? _conditionLabel;
  String? get conditionLabel => _$this._conditionLabel;
  set conditionLabel(String? conditionLabel) => _$this._conditionLabel = conditionLabel;

  num? _feelsLike;
  num? get feelsLike => _$this._feelsLike;
  set feelsLike(num? feelsLike) => _$this._feelsLike = feelsLike;

  DateTime? _fetchedAt;
  DateTime? get fetchedAt => _$this._fetchedAt;
  set fetchedAt(DateTime? fetchedAt) => _$this._fetchedAt = fetchedAt;

  num? _humidity;
  num? get humidity => _$this._humidity;
  set humidity(num? humidity) => _$this._humidity = humidity;

  num? _precipitationAmount;
  num? get precipitationAmount => _$this._precipitationAmount;
  set precipitationAmount(num? precipitationAmount) => _$this._precipitationAmount = precipitationAmount;

  num? _precipitationProbability;
  num? get precipitationProbability => _$this._precipitationProbability;
  set precipitationProbability(num? precipitationProbability) =>
      _$this._precipitationProbability = precipitationProbability;

  String? _source_;
  String? get source_ => _$this._source_;
  set source_(String? source_) => _$this._source_ = source_;

  num? _temperature;
  num? get temperature => _$this._temperature;
  set temperature(num? temperature) => _$this._temperature = temperature;

  num? _uvIndex;
  num? get uvIndex => _$this._uvIndex;
  set uvIndex(num? uvIndex) => _$this._uvIndex = uvIndex;

  num? _windSpeed;
  num? get windSpeed => _$this._windSpeed;
  set windSpeed(num? windSpeed) => _$this._windSpeed = windSpeed;

  WeatherResponseWeatherBuilder() {
    WeatherResponseWeather._defaults(this);
  }

  WeatherResponseWeatherBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _cached = $v.cached;
      _condition = $v.condition;
      _conditionLabel = $v.conditionLabel;
      _feelsLike = $v.feelsLike;
      _fetchedAt = $v.fetchedAt;
      _humidity = $v.humidity;
      _precipitationAmount = $v.precipitationAmount;
      _precipitationProbability = $v.precipitationProbability;
      _source_ = $v.source_;
      _temperature = $v.temperature;
      _uvIndex = $v.uvIndex;
      _windSpeed = $v.windSpeed;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WeatherResponseWeather other) {
    _$v = other as _$WeatherResponseWeather;
  }

  @override
  void update(void Function(WeatherResponseWeatherBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WeatherResponseWeather build() => _build();

  _$WeatherResponseWeather _build() {
    final _$result =
        _$v ??
        _$WeatherResponseWeather._(
          cached: BuiltValueNullFieldError.checkNotNull(cached, r'WeatherResponseWeather', 'cached'),
          condition: BuiltValueNullFieldError.checkNotNull(condition, r'WeatherResponseWeather', 'condition'),
          conditionLabel: BuiltValueNullFieldError.checkNotNull(
            conditionLabel,
            r'WeatherResponseWeather',
            'conditionLabel',
          ),
          feelsLike: BuiltValueNullFieldError.checkNotNull(feelsLike, r'WeatherResponseWeather', 'feelsLike'),
          fetchedAt: BuiltValueNullFieldError.checkNotNull(fetchedAt, r'WeatherResponseWeather', 'fetchedAt'),
          humidity: BuiltValueNullFieldError.checkNotNull(humidity, r'WeatherResponseWeather', 'humidity'),
          precipitationAmount: BuiltValueNullFieldError.checkNotNull(
            precipitationAmount,
            r'WeatherResponseWeather',
            'precipitationAmount',
          ),
          precipitationProbability: BuiltValueNullFieldError.checkNotNull(
            precipitationProbability,
            r'WeatherResponseWeather',
            'precipitationProbability',
          ),
          source_: BuiltValueNullFieldError.checkNotNull(source_, r'WeatherResponseWeather', 'source_'),
          temperature: BuiltValueNullFieldError.checkNotNull(temperature, r'WeatherResponseWeather', 'temperature'),
          uvIndex: BuiltValueNullFieldError.checkNotNull(uvIndex, r'WeatherResponseWeather', 'uvIndex'),
          windSpeed: BuiltValueNullFieldError.checkNotNull(windSpeed, r'WeatherResponseWeather', 'windSpeed'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
