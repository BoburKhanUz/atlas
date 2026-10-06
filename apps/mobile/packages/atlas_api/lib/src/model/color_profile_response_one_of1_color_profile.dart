//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'color_profile_response_one_of1_color_profile.g.dart';

/// ColorProfileResponseOneOf1ColorProfile
///
/// Properties:
/// * [analyzedAt] - ISO 8601, UTC
/// * [cautionColors]
/// * [confidence]
/// * [contrastLevel]
/// * [eyeColor]
/// * [hairColor]
/// * [id]
/// * [neutralColors]
/// * [recommendedColors]
/// * [season]
/// * [secondaryConfidence]
/// * [secondarySeason]
/// * [skinTone]
/// * [undertone]
/// * [undertoneConfidence]
@BuiltValue()
abstract class ColorProfileResponseOneOf1ColorProfile
    implements Built<ColorProfileResponseOneOf1ColorProfile, ColorProfileResponseOneOf1ColorProfileBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'analyzedAt')
  DateTime get analyzedAt;

  @BuiltValueField(wireName: r'cautionColors')
  BuiltList<String> get cautionColors;

  @BuiltValueField(wireName: r'confidence')
  num? get confidence;

  @BuiltValueField(wireName: r'contrastLevel')
  String? get contrastLevel;

  @BuiltValueField(wireName: r'eyeColor')
  String? get eyeColor;

  @BuiltValueField(wireName: r'hairColor')
  String? get hairColor;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'neutralColors')
  BuiltList<String> get neutralColors;

  @BuiltValueField(wireName: r'recommendedColors')
  BuiltList<String> get recommendedColors;

  @BuiltValueField(wireName: r'season')
  String? get season;

  @BuiltValueField(wireName: r'secondaryConfidence')
  num? get secondaryConfidence;

  @BuiltValueField(wireName: r'secondarySeason')
  String? get secondarySeason;

  @BuiltValueField(wireName: r'skinTone')
  String? get skinTone;

  @BuiltValueField(wireName: r'undertone')
  String? get undertone;

  @BuiltValueField(wireName: r'undertoneConfidence')
  num? get undertoneConfidence;

  ColorProfileResponseOneOf1ColorProfile._();

  factory ColorProfileResponseOneOf1ColorProfile([void updates(ColorProfileResponseOneOf1ColorProfileBuilder b)]) =
      _$ColorProfileResponseOneOf1ColorProfile;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorProfileResponseOneOf1ColorProfileBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorProfileResponseOneOf1ColorProfile> get serializer =>
      _$ColorProfileResponseOneOf1ColorProfileSerializer();
}

class _$ColorProfileResponseOneOf1ColorProfileSerializer
    implements PrimitiveSerializer<ColorProfileResponseOneOf1ColorProfile> {
  @override
  final Iterable<Type> types = const [ColorProfileResponseOneOf1ColorProfile, _$ColorProfileResponseOneOf1ColorProfile];

  @override
  final String wireName = r'ColorProfileResponseOneOf1ColorProfile';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorProfileResponseOneOf1ColorProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'analyzedAt';
    yield serializers.serialize(object.analyzedAt, specifiedType: const FullType(DateTime));
    yield r'cautionColors';
    yield serializers.serialize(object.cautionColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'confidence';
    yield object.confidence == null
        ? null
        : serializers.serialize(object.confidence, specifiedType: const FullType.nullable(num));
    yield r'contrastLevel';
    yield object.contrastLevel == null
        ? null
        : serializers.serialize(object.contrastLevel, specifiedType: const FullType.nullable(String));
    yield r'eyeColor';
    yield object.eyeColor == null
        ? null
        : serializers.serialize(object.eyeColor, specifiedType: const FullType.nullable(String));
    yield r'hairColor';
    yield object.hairColor == null
        ? null
        : serializers.serialize(object.hairColor, specifiedType: const FullType.nullable(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'neutralColors';
    yield serializers.serialize(object.neutralColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'recommendedColors';
    yield serializers.serialize(object.recommendedColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'season';
    yield object.season == null
        ? null
        : serializers.serialize(object.season, specifiedType: const FullType.nullable(String));
    yield r'secondaryConfidence';
    yield object.secondaryConfidence == null
        ? null
        : serializers.serialize(object.secondaryConfidence, specifiedType: const FullType.nullable(num));
    yield r'secondarySeason';
    yield object.secondarySeason == null
        ? null
        : serializers.serialize(object.secondarySeason, specifiedType: const FullType.nullable(String));
    yield r'skinTone';
    yield object.skinTone == null
        ? null
        : serializers.serialize(object.skinTone, specifiedType: const FullType.nullable(String));
    yield r'undertone';
    yield object.undertone == null
        ? null
        : serializers.serialize(object.undertone, specifiedType: const FullType.nullable(String));
    yield r'undertoneConfidence';
    yield object.undertoneConfidence == null
        ? null
        : serializers.serialize(object.undertoneConfidence, specifiedType: const FullType.nullable(num));
  }

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseOneOf1ColorProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ColorProfileResponseOneOf1ColorProfileBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'analyzedAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.analyzedAt = valueDes;
          break;
        case r'cautionColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.cautionColors.replace(valueDes);
          break;
        case r'confidence':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.confidence = valueDes;
          break;
        case r'contrastLevel':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.contrastLevel = valueDes;
          break;
        case r'eyeColor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.eyeColor = valueDes;
          break;
        case r'hairColor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.hairColor = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'neutralColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.neutralColors.replace(valueDes);
          break;
        case r'recommendedColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.recommendedColors.replace(valueDes);
          break;
        case r'season':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.season = valueDes;
          break;
        case r'secondaryConfidence':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.secondaryConfidence = valueDes;
          break;
        case r'secondarySeason':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.secondarySeason = valueDes;
          break;
        case r'skinTone':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.skinTone = valueDes;
          break;
        case r'undertone':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.undertone = valueDes;
          break;
        case r'undertoneConfidence':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.undertoneConfidence = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ColorProfileResponseOneOf1ColorProfile deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorProfileResponseOneOf1ColorProfileBuilder();
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
