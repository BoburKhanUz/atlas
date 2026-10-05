//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'color_profile_response_one_of.g.dart';

/// ColorProfileResponseOneOf
///
/// Properties:
/// * [colorProfile]
/// * [message]
/// * [status]
@BuiltValue()
abstract class ColorProfileResponseOneOf implements Built<ColorProfileResponseOneOf, ColorProfileResponseOneOfBuilder> {
  @BuiltValueField(wireName: r'colorProfile')
  JsonObject? get colorProfile;

  @BuiltValueField(wireName: r'message')
  String get message;

  @BuiltValueField(wireName: r'status')
  ColorProfileResponseOneOfStatusEnum get status;
  // enum statusEnum {  not_analyzed,  };

  ColorProfileResponseOneOf._();

  factory ColorProfileResponseOneOf([void updates(ColorProfileResponseOneOfBuilder b)]) = _$ColorProfileResponseOneOf;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorProfileResponseOneOfBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorProfileResponseOneOf> get serializer => _$ColorProfileResponseOneOfSerializer();
}

class _$ColorProfileResponseOneOfSerializer implements PrimitiveSerializer<ColorProfileResponseOneOf> {
  @override
  final Iterable<Type> types = const [ColorProfileResponseOneOf, _$ColorProfileResponseOneOf];

  @override
  final String wireName = r'ColorProfileResponseOneOf';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorProfileResponseOneOf object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'colorProfile';
    yield object.colorProfile == null
        ? null
        : serializers.serialize(object.colorProfile, specifiedType: const FullType.nullable(JsonObject));
    yield r'message';
    yield serializers.serialize(object.message, specifiedType: const FullType(String));
    yield r'status';
    yield serializers.serialize(object.status, specifiedType: const FullType(ColorProfileResponseOneOfStatusEnum));
  }

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseOneOf object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ColorProfileResponseOneOfBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'colorProfile':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(JsonObject)) as JsonObject?;
          if (valueDes == null) continue;
          result.colorProfile = valueDes;
          break;
        case r'message':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.message = valueDes;
          break;
        case r'status':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ColorProfileResponseOneOfStatusEnum),
          ) as ColorProfileResponseOneOfStatusEnum;
          result.status = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ColorProfileResponseOneOf deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorProfileResponseOneOfBuilder();
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

class ColorProfileResponseOneOfStatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'not_analyzed')
  static const ColorProfileResponseOneOfStatusEnum notAnalyzed = _$colorProfileResponseOneOfStatusEnum_notAnalyzed;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ColorProfileResponseOneOfStatusEnum unknownDefaultOpenApi =
      _$colorProfileResponseOneOfStatusEnum_unknownDefaultOpenApi;

  static Serializer<ColorProfileResponseOneOfStatusEnum> get serializer =>
      _$colorProfileResponseOneOfStatusEnumSerializer;

  const ColorProfileResponseOneOfStatusEnum._(String name) : super(name);

  static BuiltSet<ColorProfileResponseOneOfStatusEnum> get values => _$colorProfileResponseOneOfStatusEnumValues;
  static ColorProfileResponseOneOfStatusEnum valueOf(String name) => _$colorProfileResponseOneOfStatusEnumValueOf(name);
}
