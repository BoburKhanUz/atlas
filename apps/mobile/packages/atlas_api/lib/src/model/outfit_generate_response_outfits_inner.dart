//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:atlas_api/src/model/outfit_generate_response_outfits_inner_items_inner.dart';
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/outfit_generate_response_outfits_inner_factors.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_generate_response_outfits_inner.g.dart';

/// OutfitGenerateResponseOutfitsInner
///
/// Properties:
/// * [contrastLevel]
/// * [explanation]
/// * [factors]
/// * [items]
/// * [reasons]
/// * [score]
/// * [tempId]
@BuiltValue()
abstract class OutfitGenerateResponseOutfitsInner
    implements Built<OutfitGenerateResponseOutfitsInner, OutfitGenerateResponseOutfitsInnerBuilder> {
  @BuiltValueField(wireName: r'contrastLevel')
  OutfitGenerateResponseOutfitsInnerContrastLevelEnum get contrastLevel;
  // enum contrastLevelEnum {  low,  medium,  high,  };

  @BuiltValueField(wireName: r'explanation')
  ColorAnalysisResponseColorProfileContrastLevel? get explanation;

  @BuiltValueField(wireName: r'factors')
  OutfitGenerateResponseOutfitsInnerFactors get factors;

  @BuiltValueField(wireName: r'items')
  BuiltList<OutfitGenerateResponseOutfitsInnerItemsInner> get items;

  @BuiltValueField(wireName: r'reasons')
  BuiltList<String> get reasons;

  @BuiltValueField(wireName: r'score')
  num get score;

  @BuiltValueField(wireName: r'tempId')
  String get tempId;

  OutfitGenerateResponseOutfitsInner._();

  factory OutfitGenerateResponseOutfitsInner([void updates(OutfitGenerateResponseOutfitsInnerBuilder b)]) =
      _$OutfitGenerateResponseOutfitsInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateResponseOutfitsInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateResponseOutfitsInner> get serializer =>
      _$OutfitGenerateResponseOutfitsInnerSerializer();
}

class _$OutfitGenerateResponseOutfitsInnerSerializer
    implements PrimitiveSerializer<OutfitGenerateResponseOutfitsInner> {
  @override
  final Iterable<Type> types = const [OutfitGenerateResponseOutfitsInner, _$OutfitGenerateResponseOutfitsInner];

  @override
  final String wireName = r'OutfitGenerateResponseOutfitsInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'contrastLevel';
    yield serializers.serialize(
      object.contrastLevel,
      specifiedType: const FullType(OutfitGenerateResponseOutfitsInnerContrastLevelEnum),
    );
    yield r'explanation';
    yield object.explanation == null
        ? null
        : serializers.serialize(
            object.explanation,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'factors';
    yield serializers.serialize(
      object.factors,
      specifiedType: const FullType(OutfitGenerateResponseOutfitsInnerFactors),
    );
    yield r'items';
    yield serializers.serialize(
      object.items,
      specifiedType: const FullType(BuiltList, [FullType(OutfitGenerateResponseOutfitsInnerItemsInner)]),
    );
    yield r'reasons';
    yield serializers.serialize(object.reasons, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'score';
    yield serializers.serialize(object.score, specifiedType: const FullType(num));
    yield r'tempId';
    yield serializers.serialize(object.tempId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitGenerateResponseOutfitsInnerBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'contrastLevel':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitGenerateResponseOutfitsInnerContrastLevelEnum),
          ) as OutfitGenerateResponseOutfitsInnerContrastLevelEnum;
          result.contrastLevel = valueDes;
          break;
        case r'explanation':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.explanation.replace(valueDes);
          break;
        case r'factors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitGenerateResponseOutfitsInnerFactors),
          ) as OutfitGenerateResponseOutfitsInnerFactors;
          result.factors.replace(valueDes);
          break;
        case r'items':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(OutfitGenerateResponseOutfitsInnerItemsInner)]),
          ) as BuiltList<OutfitGenerateResponseOutfitsInnerItemsInner>;
          result.items.replace(valueDes);
          break;
        case r'reasons':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.reasons.replace(valueDes);
          break;
        case r'score':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.score = valueDes;
          break;
        case r'tempId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.tempId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitGenerateResponseOutfitsInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateResponseOutfitsInnerBuilder();
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

class OutfitGenerateResponseOutfitsInnerContrastLevelEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'low')
  static const OutfitGenerateResponseOutfitsInnerContrastLevelEnum low =
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_low;
  @BuiltValueEnumConst(wireName: r'medium')
  static const OutfitGenerateResponseOutfitsInnerContrastLevelEnum medium =
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_medium;
  @BuiltValueEnumConst(wireName: r'high')
  static const OutfitGenerateResponseOutfitsInnerContrastLevelEnum high =
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_high;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const OutfitGenerateResponseOutfitsInnerContrastLevelEnum unknownDefaultOpenApi =
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnum_unknownDefaultOpenApi;

  static Serializer<OutfitGenerateResponseOutfitsInnerContrastLevelEnum> get serializer =>
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnumSerializer;

  const OutfitGenerateResponseOutfitsInnerContrastLevelEnum._(String name) : super(name);

  static BuiltSet<OutfitGenerateResponseOutfitsInnerContrastLevelEnum> get values =>
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnumValues;
  static OutfitGenerateResponseOutfitsInnerContrastLevelEnum valueOf(String name) =>
      _$outfitGenerateResponseOutfitsInnerContrastLevelEnumValueOf(name);
}
