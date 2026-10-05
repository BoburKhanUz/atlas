//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_generate_response_weather_used_any_of.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'outfit_generate_response_weather_used.g.dart';

/// OutfitGenerateResponseWeatherUsed
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
abstract class OutfitGenerateResponseWeatherUsed
    implements Built<OutfitGenerateResponseWeatherUsed, OutfitGenerateResponseWeatherUsedBuilder> {
  /// Any Of [JsonObject], [OutfitGenerateResponseWeatherUsedAnyOf]
  AnyOf get anyOf;

  OutfitGenerateResponseWeatherUsed._();

  factory OutfitGenerateResponseWeatherUsed([void updates(OutfitGenerateResponseWeatherUsedBuilder b)]) =
      _$OutfitGenerateResponseWeatherUsed;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateResponseWeatherUsedBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateResponseWeatherUsed> get serializer =>
      _$OutfitGenerateResponseWeatherUsedSerializer();
}

class _$OutfitGenerateResponseWeatherUsedSerializer implements PrimitiveSerializer<OutfitGenerateResponseWeatherUsed> {
  @override
  final Iterable<Type> types = const [OutfitGenerateResponseWeatherUsed, _$OutfitGenerateResponseWeatherUsed];

  @override
  final String wireName = r'OutfitGenerateResponseWeatherUsed';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateResponseWeatherUsed object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {}

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponseWeatherUsed object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final anyOf = object.anyOf;
    return serializers.serialize(
      anyOf,
      specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()),
    )!;
  }

  @override
  OutfitGenerateResponseWeatherUsed deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateResponseWeatherUsedBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [
      FullType(OutfitGenerateResponseWeatherUsedAnyOf),
      FullType.nullable(JsonObject),
    ]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}
