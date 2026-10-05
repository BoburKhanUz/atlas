//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/color_profile_response_one_of1_color_profile.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'color_profile_response_one_of1.g.dart';

/// ColorProfileResponseOneOf1
///
/// Properties:
/// * [colorProfile]
/// * [disclaimer]
/// * [status]
@BuiltValue()
abstract class ColorProfileResponseOneOf1
    implements Built<ColorProfileResponseOneOf1, ColorProfileResponseOneOf1Builder> {
  @BuiltValueField(wireName: r'colorProfile')
  ColorProfileResponseOneOf1ColorProfile get colorProfile;

  @BuiltValueField(wireName: r'disclaimer')
  String get disclaimer;

  @BuiltValueField(wireName: r'status')
  ColorProfileResponseOneOf1StatusEnum get status;
  // enum statusEnum {  analyzed,  };

  ColorProfileResponseOneOf1._();

  factory ColorProfileResponseOneOf1([void updates(ColorProfileResponseOneOf1Builder b)]) =
      _$ColorProfileResponseOneOf1;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorProfileResponseOneOf1Builder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorProfileResponseOneOf1> get serializer => _$ColorProfileResponseOneOf1Serializer();
}

class _$ColorProfileResponseOneOf1Serializer implements PrimitiveSerializer<ColorProfileResponseOneOf1> {
  @override
  final Iterable<Type> types = const [ColorProfileResponseOneOf1, _$ColorProfileResponseOneOf1];

  @override
  final String wireName = r'ColorProfileResponseOneOf1';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorProfileResponseOneOf1 object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'colorProfile';
    yield serializers.serialize(
      object.colorProfile,
      specifiedType: const FullType(ColorProfileResponseOneOf1ColorProfile),
    );
    yield r'disclaimer';
    yield serializers.serialize(object.disclaimer, specifiedType: const FullType(String));
    yield r'status';
    yield serializers.serialize(object.status, specifiedType: const FullType(ColorProfileResponseOneOf1StatusEnum));
  }

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseOneOf1 object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ColorProfileResponseOneOf1Builder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'colorProfile':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ColorProfileResponseOneOf1ColorProfile),
          ) as ColorProfileResponseOneOf1ColorProfile;
          result.colorProfile.replace(valueDes);
          break;
        case r'disclaimer':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.disclaimer = valueDes;
          break;
        case r'status':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ColorProfileResponseOneOf1StatusEnum),
          ) as ColorProfileResponseOneOf1StatusEnum;
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
  ColorProfileResponseOneOf1 deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorProfileResponseOneOf1Builder();
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

class ColorProfileResponseOneOf1StatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'analyzed')
  static const ColorProfileResponseOneOf1StatusEnum analyzed = _$colorProfileResponseOneOf1StatusEnum_analyzed;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ColorProfileResponseOneOf1StatusEnum unknownDefaultOpenApi =
      _$colorProfileResponseOneOf1StatusEnum_unknownDefaultOpenApi;

  static Serializer<ColorProfileResponseOneOf1StatusEnum> get serializer =>
      _$colorProfileResponseOneOf1StatusEnumSerializer;

  const ColorProfileResponseOneOf1StatusEnum._(String name) : super(name);

  static BuiltSet<ColorProfileResponseOneOf1StatusEnum> get values => _$colorProfileResponseOneOf1StatusEnumValues;
  static ColorProfileResponseOneOf1StatusEnum valueOf(String name) =>
      _$colorProfileResponseOneOf1StatusEnumValueOf(name);
}
