//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'weather_response_weather.g.dart';

/// WeatherResponseWeather
///
/// Properties:
/// * [cached]
/// * [condition]
/// * [conditionLabel]
/// * [feelsLike]
/// * [fetchedAt] - ISO 8601, UTC
/// * [humidity]
/// * [precipitationAmount]
/// * [precipitationProbability]
/// * [source_]
/// * [temperature]
/// * [uvIndex]
/// * [windSpeed]
@BuiltValue()
abstract class WeatherResponseWeather implements Built<WeatherResponseWeather, WeatherResponseWeatherBuilder> {
  @BuiltValueField(wireName: r'cached')
  bool get cached;

  @BuiltValueField(wireName: r'condition')
  String get condition;

  @BuiltValueField(wireName: r'conditionLabel')
  String get conditionLabel;

  @BuiltValueField(wireName: r'feelsLike')
  num get feelsLike;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'fetchedAt')
  DateTime get fetchedAt;

  @BuiltValueField(wireName: r'humidity')
  num get humidity;

  @BuiltValueField(wireName: r'precipitationAmount')
  num get precipitationAmount;

  @BuiltValueField(wireName: r'precipitationProbability')
  num get precipitationProbability;

  @BuiltValueField(wireName: r'source')
  String get source_;

  @BuiltValueField(wireName: r'temperature')
  num get temperature;

  @BuiltValueField(wireName: r'uvIndex')
  num get uvIndex;

  @BuiltValueField(wireName: r'windSpeed')
  num get windSpeed;

  WeatherResponseWeather._();

  factory WeatherResponseWeather([void updates(WeatherResponseWeatherBuilder b)]) = _$WeatherResponseWeather;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WeatherResponseWeatherBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WeatherResponseWeather> get serializer => _$WeatherResponseWeatherSerializer();
}

class _$WeatherResponseWeatherSerializer implements PrimitiveSerializer<WeatherResponseWeather> {
  @override
  final Iterable<Type> types = const [WeatherResponseWeather, _$WeatherResponseWeather];

  @override
  final String wireName = r'WeatherResponseWeather';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WeatherResponseWeather object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'cached';
    yield serializers.serialize(object.cached, specifiedType: const FullType(bool));
    yield r'condition';
    yield serializers.serialize(object.condition, specifiedType: const FullType(String));
    yield r'conditionLabel';
    yield serializers.serialize(object.conditionLabel, specifiedType: const FullType(String));
    yield r'feelsLike';
    yield serializers.serialize(object.feelsLike, specifiedType: const FullType(num));
    yield r'fetchedAt';
    yield serializers.serialize(object.fetchedAt, specifiedType: const FullType(DateTime));
    yield r'humidity';
    yield serializers.serialize(object.humidity, specifiedType: const FullType(num));
    yield r'precipitationAmount';
    yield serializers.serialize(object.precipitationAmount, specifiedType: const FullType(num));
    yield r'precipitationProbability';
    yield serializers.serialize(object.precipitationProbability, specifiedType: const FullType(num));
    yield r'source';
    yield serializers.serialize(object.source_, specifiedType: const FullType(String));
    yield r'temperature';
    yield serializers.serialize(object.temperature, specifiedType: const FullType(num));
    yield r'uvIndex';
    yield serializers.serialize(object.uvIndex, specifiedType: const FullType(num));
    yield r'windSpeed';
    yield serializers.serialize(object.windSpeed, specifiedType: const FullType(num));
  }

  @override
  Object serialize(
    Serializers serializers,
    WeatherResponseWeather object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WeatherResponseWeatherBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'cached':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.cached = valueDes;
          break;
        case r'condition':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.condition = valueDes;
          break;
        case r'conditionLabel':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.conditionLabel = valueDes;
          break;
        case r'feelsLike':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.feelsLike = valueDes;
          break;
        case r'fetchedAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.fetchedAt = valueDes;
          break;
        case r'humidity':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.humidity = valueDes;
          break;
        case r'precipitationAmount':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.precipitationAmount = valueDes;
          break;
        case r'precipitationProbability':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.precipitationProbability = valueDes;
          break;
        case r'source':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.source_ = valueDes;
          break;
        case r'temperature':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.temperature = valueDes;
          break;
        case r'uvIndex':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.uvIndex = valueDes;
          break;
        case r'windSpeed':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.windSpeed = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WeatherResponseWeather deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WeatherResponseWeatherBuilder();
    final serializedList = (serialized as Iterable<Object?>).toList();
    final unhandled = <Object?>[];
    _deserializeProperties(
      serializers,
      serialized,
      specifiedType: specifiedType,
      serializedList: serializedList,
      unhandled: unhandled,
      result: result,
    );
    return result.build();
  }
}
