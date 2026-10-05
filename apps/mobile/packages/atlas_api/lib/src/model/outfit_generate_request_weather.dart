//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_generate_request_weather.g.dart';

/// OutfitGenerateRequestWeather
///
/// Properties:
/// * [condition]
/// * [feelsLike]
/// * [humidity]
/// * [precipitationProbability]
/// * [temperature]
/// * [uvIndex]
/// * [windSpeed]
@BuiltValue()
abstract class OutfitGenerateRequestWeather
    implements Built<OutfitGenerateRequestWeather, OutfitGenerateRequestWeatherBuilder> {
  @BuiltValueField(wireName: r'condition')
  String get condition;

  @BuiltValueField(wireName: r'feelsLike')
  num get feelsLike;

  @BuiltValueField(wireName: r'humidity')
  num get humidity;

  @BuiltValueField(wireName: r'precipitationProbability')
  num get precipitationProbability;

  @BuiltValueField(wireName: r'temperature')
  num get temperature;

  @BuiltValueField(wireName: r'uvIndex')
  num get uvIndex;

  @BuiltValueField(wireName: r'windSpeed')
  num get windSpeed;

  OutfitGenerateRequestWeather._();

  factory OutfitGenerateRequestWeather([void updates(OutfitGenerateRequestWeatherBuilder b)]) =
      _$OutfitGenerateRequestWeather;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateRequestWeatherBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateRequestWeather> get serializer => _$OutfitGenerateRequestWeatherSerializer();
}

class _$OutfitGenerateRequestWeatherSerializer implements PrimitiveSerializer<OutfitGenerateRequestWeather> {
  @override
  final Iterable<Type> types = const [OutfitGenerateRequestWeather, _$OutfitGenerateRequestWeather];

  @override
  final String wireName = r'OutfitGenerateRequestWeather';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateRequestWeather object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'condition';
    yield serializers.serialize(object.condition, specifiedType: const FullType(String));
    yield r'feelsLike';
    yield serializers.serialize(object.feelsLike, specifiedType: const FullType(num));
    yield r'humidity';
    yield serializers.serialize(object.humidity, specifiedType: const FullType(num));
    yield r'precipitationProbability';
    yield serializers.serialize(object.precipitationProbability, specifiedType: const FullType(num));
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
    OutfitGenerateRequestWeather object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitGenerateRequestWeatherBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'condition':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.condition = valueDes;
          break;
        case r'feelsLike':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.feelsLike = valueDes;
          break;
        case r'humidity':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.humidity = valueDes;
          break;
        case r'precipitationProbability':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.precipitationProbability = valueDes;
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
  OutfitGenerateRequestWeather deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateRequestWeatherBuilder();
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
