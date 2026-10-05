//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/color_profile_response_one_of.dart';
import 'package:atlas_api/src/model/color_profile_response_one_of1_color_profile.dart';
import 'package:atlas_api/src/model/color_profile_response_one_of1.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/one_of.dart';

part 'color_profile_response.g.dart';

/// ColorProfileResponse
///
/// Properties:
/// * [colorProfile]
/// * [message]
/// * [status]
/// * [disclaimer]
@BuiltValue()
abstract class ColorProfileResponse implements Built<ColorProfileResponse, ColorProfileResponseBuilder> {
  /// One Of [ColorProfileResponseOneOf], [ColorProfileResponseOneOf1]
  OneOf get oneOf;

  ColorProfileResponse._();

  factory ColorProfileResponse([void updates(ColorProfileResponseBuilder b)]) = _$ColorProfileResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorProfileResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorProfileResponse> get serializer => _$ColorProfileResponseSerializer();
}

class _$ColorProfileResponseSerializer implements PrimitiveSerializer<ColorProfileResponse> {
  @override
  final Iterable<Type> types = const [ColorProfileResponse, _$ColorProfileResponse];

  @override
  final String wireName = r'ColorProfileResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorProfileResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {}

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final oneOf = object.oneOf;
    return serializers.serialize(oneOf.value, specifiedType: FullType(oneOf.valueType))!;
  }

  @override
  ColorProfileResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorProfileResponseBuilder();
    Object? oneOfDataSrc;
    final targetType = const FullType(OneOf, [
      FullType(ColorProfileResponseOneOf),
      FullType(ColorProfileResponseOneOf1),
    ]);
    oneOfDataSrc = serialized;
    result.oneOf = serializers.deserialize(oneOfDataSrc, specifiedType: targetType) as OneOf;
    return result.build();
  }
}

class ColorProfileResponseStatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'analyzed')
  static const ColorProfileResponseStatusEnum analyzed = _$colorProfileResponseStatusEnum_analyzed;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ColorProfileResponseStatusEnum unknownDefaultOpenApi =
      _$colorProfileResponseStatusEnum_unknownDefaultOpenApi;

  static Serializer<ColorProfileResponseStatusEnum> get serializer => _$colorProfileResponseStatusEnumSerializer;

  const ColorProfileResponseStatusEnum._(String name) : super(name);

  static BuiltSet<ColorProfileResponseStatusEnum> get values => _$colorProfileResponseStatusEnumValues;
  static ColorProfileResponseStatusEnum valueOf(String name) => _$colorProfileResponseStatusEnumValueOf(name);
}
