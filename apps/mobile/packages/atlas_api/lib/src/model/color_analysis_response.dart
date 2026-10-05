//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/color_analysis_response_color_profile.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'color_analysis_response.g.dart';

/// ColorAnalysisResponse
///
/// Properties:
/// * [colorProfile]
/// * [disclaimer]
@BuiltValue()
abstract class ColorAnalysisResponse implements Built<ColorAnalysisResponse, ColorAnalysisResponseBuilder> {
  @BuiltValueField(wireName: r'colorProfile')
  ColorAnalysisResponseColorProfile get colorProfile;

  @BuiltValueField(wireName: r'disclaimer')
  String get disclaimer;

  ColorAnalysisResponse._();

  factory ColorAnalysisResponse([void updates(ColorAnalysisResponseBuilder b)]) = _$ColorAnalysisResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorAnalysisResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorAnalysisResponse> get serializer => _$ColorAnalysisResponseSerializer();
}

class _$ColorAnalysisResponseSerializer implements PrimitiveSerializer<ColorAnalysisResponse> {
  @override
  final Iterable<Type> types = const [ColorAnalysisResponse, _$ColorAnalysisResponse];

  @override
  final String wireName = r'ColorAnalysisResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorAnalysisResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'colorProfile';
    yield serializers.serialize(object.colorProfile, specifiedType: const FullType(ColorAnalysisResponseColorProfile));
    yield r'disclaimer';
    yield serializers.serialize(object.disclaimer, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    ColorAnalysisResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ColorAnalysisResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'colorProfile':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ColorAnalysisResponseColorProfile),
          ) as ColorAnalysisResponseColorProfile;
          result.colorProfile.replace(valueDes);
          break;
        case r'disclaimer':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.disclaimer = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ColorAnalysisResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorAnalysisResponseBuilder();
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
