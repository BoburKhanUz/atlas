//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_generate_response_outfits_inner.dart';
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:atlas_api/src/model/outfit_generate_response_weather_used.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_generate_response.g.dart';

/// OutfitGenerateResponse
///
/// Properties:
/// * [fallback] - true when the optional AI ranking/explanation was not used (deterministic order and explanations)
/// * [message] - Why no outfits were generated
/// * [occasion]
/// * [outfits]
/// * [wardrobeItemCount]
/// * [weatherUsed]
@BuiltValue()
abstract class OutfitGenerateResponse implements Built<OutfitGenerateResponse, OutfitGenerateResponseBuilder> {
  /// true when the optional AI ranking/explanation was not used (deterministic order and explanations)
  @BuiltValueField(wireName: r'fallback')
  bool get fallback;

  /// Why no outfits were generated
  @BuiltValueField(wireName: r'message')
  String? get message;

  @BuiltValueField(wireName: r'occasion')
  ColorAnalysisResponseColorProfileContrastLevel? get occasion;

  @BuiltValueField(wireName: r'outfits')
  BuiltList<OutfitGenerateResponseOutfitsInner> get outfits;

  @BuiltValueField(wireName: r'wardrobeItemCount')
  int get wardrobeItemCount;

  @BuiltValueField(wireName: r'weatherUsed')
  OutfitGenerateResponseWeatherUsed get weatherUsed;

  OutfitGenerateResponse._();

  factory OutfitGenerateResponse([void updates(OutfitGenerateResponseBuilder b)]) = _$OutfitGenerateResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateResponse> get serializer => _$OutfitGenerateResponseSerializer();
}

class _$OutfitGenerateResponseSerializer implements PrimitiveSerializer<OutfitGenerateResponse> {
  @override
  final Iterable<Type> types = const [OutfitGenerateResponse, _$OutfitGenerateResponse];

  @override
  final String wireName = r'OutfitGenerateResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'fallback';
    yield serializers.serialize(object.fallback, specifiedType: const FullType(bool));
    if (object.message != null) {
      yield r'message';
      yield serializers.serialize(object.message, specifiedType: const FullType(String));
    }
    yield r'occasion';
    yield object.occasion == null
        ? null
        : serializers.serialize(
            object.occasion,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'outfits';
    yield serializers.serialize(
      object.outfits,
      specifiedType: const FullType(BuiltList, [FullType(OutfitGenerateResponseOutfitsInner)]),
    );
    yield r'wardrobeItemCount';
    yield serializers.serialize(object.wardrobeItemCount, specifiedType: const FullType(int));
    yield r'weatherUsed';
    yield serializers.serialize(object.weatherUsed, specifiedType: const FullType(OutfitGenerateResponseWeatherUsed));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitGenerateResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'fallback':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.fallback = valueDes;
          break;
        case r'message':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.message = valueDes;
          break;
        case r'occasion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.occasion.replace(valueDes);
          break;
        case r'outfits':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(OutfitGenerateResponseOutfitsInner)]),
          ) as BuiltList<OutfitGenerateResponseOutfitsInner>;
          result.outfits.replace(valueDes);
          break;
        case r'wardrobeItemCount':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(int)) as int;
          result.wardrobeItemCount = valueDes;
          break;
        case r'weatherUsed':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitGenerateResponseWeatherUsed),
          ) as OutfitGenerateResponseWeatherUsed;
          result.weatherUsed.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitGenerateResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateResponseBuilder();
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
