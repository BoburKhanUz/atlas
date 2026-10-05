//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/weather_response_weather.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'weather_response.g.dart';

/// WeatherResponse
///
/// Properties:
/// * [weather]
@BuiltValue()
abstract class WeatherResponse implements Built<WeatherResponse, WeatherResponseBuilder> {
  @BuiltValueField(wireName: r'weather')
  WeatherResponseWeather get weather;

  WeatherResponse._();

  factory WeatherResponse([void updates(WeatherResponseBuilder b)]) = _$WeatherResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WeatherResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WeatherResponse> get serializer => _$WeatherResponseSerializer();
}

class _$WeatherResponseSerializer implements PrimitiveSerializer<WeatherResponse> {
  @override
  final Iterable<Type> types = const [WeatherResponse, _$WeatherResponse];

  @override
  final String wireName = r'WeatherResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WeatherResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'weather';
    yield serializers.serialize(object.weather, specifiedType: const FullType(WeatherResponseWeather));
  }

  @override
  Object serialize(Serializers serializers, WeatherResponse object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WeatherResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'weather':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(WeatherResponseWeather),
          ) as WeatherResponseWeather;
          result.weather.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WeatherResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WeatherResponseBuilder();
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
