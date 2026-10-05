//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'color_analysis_response_color_profile.g.dart';

/// ColorAnalysisResponseColorProfile
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
/// * [skinTone]
/// * [undertone]
@BuiltValue()
abstract class ColorAnalysisResponseColorProfile
    implements Built<ColorAnalysisResponseColorProfile, ColorAnalysisResponseColorProfileBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'analyzedAt')
  DateTime get analyzedAt;

  @BuiltValueField(wireName: r'cautionColors')
  BuiltList<String> get cautionColors;

  @BuiltValueField(wireName: r'confidence')
  num get confidence;

  @BuiltValueField(wireName: r'contrastLevel')
  ColorAnalysisResponseColorProfileContrastLevel? get contrastLevel;

  @BuiltValueField(wireName: r'eyeColor')
  ColorAnalysisResponseColorProfileContrastLevel? get eyeColor;

  @BuiltValueField(wireName: r'hairColor')
  ColorAnalysisResponseColorProfileContrastLevel? get hairColor;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'neutralColors')
  BuiltList<String> get neutralColors;

  @BuiltValueField(wireName: r'recommendedColors')
  BuiltList<String> get recommendedColors;

  @BuiltValueField(wireName: r'season')
  ColorAnalysisResponseColorProfileContrastLevel? get season;

  @BuiltValueField(wireName: r'skinTone')
  ColorAnalysisResponseColorProfileContrastLevel? get skinTone;

  @BuiltValueField(wireName: r'undertone')
  ColorAnalysisResponseColorProfileContrastLevel? get undertone;

  ColorAnalysisResponseColorProfile._();

  factory ColorAnalysisResponseColorProfile([void updates(ColorAnalysisResponseColorProfileBuilder b)]) =
      _$ColorAnalysisResponseColorProfile;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorAnalysisResponseColorProfileBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorAnalysisResponseColorProfile> get serializer =>
      _$ColorAnalysisResponseColorProfileSerializer();
}

class _$ColorAnalysisResponseColorProfileSerializer implements PrimitiveSerializer<ColorAnalysisResponseColorProfile> {
  @override
  final Iterable<Type> types = const [ColorAnalysisResponseColorProfile, _$ColorAnalysisResponseColorProfile];

  @override
  final String wireName = r'ColorAnalysisResponseColorProfile';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorAnalysisResponseColorProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'analyzedAt';
    yield serializers.serialize(object.analyzedAt, specifiedType: const FullType(DateTime));
    yield r'cautionColors';
    yield serializers.serialize(object.cautionColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'confidence';
    yield serializers.serialize(object.confidence, specifiedType: const FullType(num));
    yield r'contrastLevel';
    yield object.contrastLevel == null
        ? null
        : serializers.serialize(
            object.contrastLevel,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'eyeColor';
    yield object.eyeColor == null
        ? null
        : serializers.serialize(
            object.eyeColor,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'hairColor';
    yield object.hairColor == null
        ? null
        : serializers.serialize(
            object.hairColor,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'neutralColors';
    yield serializers.serialize(object.neutralColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'recommendedColors';
    yield serializers.serialize(object.recommendedColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'season';
    yield object.season == null
        ? null
        : serializers.serialize(
            object.season,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'skinTone';
    yield object.skinTone == null
        ? null
        : serializers.serialize(
            object.skinTone,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'undertone';
    yield object.undertone == null
        ? null
        : serializers.serialize(
            object.undertone,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
  }

  @override
  Object serialize(
    Serializers serializers,
    ColorAnalysisResponseColorProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ColorAnalysisResponseColorProfileBuilder result,
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
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.confidence = valueDes;
          break;
        case r'contrastLevel':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.contrastLevel.replace(valueDes);
          break;
        case r'eyeColor':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.eyeColor.replace(valueDes);
          break;
        case r'hairColor':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.hairColor.replace(valueDes);
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
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.season.replace(valueDes);
          break;
        case r'skinTone':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.skinTone.replace(valueDes);
          break;
        case r'undertone':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.undertone.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ColorAnalysisResponseColorProfile deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorAnalysisResponseColorProfileBuilder();
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
