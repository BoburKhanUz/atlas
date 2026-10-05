//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/image_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_detail_item_item.g.dart';

/// OutfitDetailItemItem
///
/// Properties:
/// * [category]
/// * [colors]
/// * [id]
/// * [images]
/// * [material]
/// * [season]
/// * [style]
/// * [subcategory]
@BuiltValue()
abstract class OutfitDetailItemItem implements Built<OutfitDetailItemItem, OutfitDetailItemItemBuilder> {
  @BuiltValueField(wireName: r'category')
  String get category;

  @BuiltValueField(wireName: r'colors')
  BuiltList<String> get colors;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'images')
  BuiltList<ImageObject> get images;

  @BuiltValueField(wireName: r'material')
  ColorAnalysisResponseColorProfileContrastLevel? get material;

  @BuiltValueField(wireName: r'season')
  BuiltList<String> get season;

  @BuiltValueField(wireName: r'style')
  ColorAnalysisResponseColorProfileContrastLevel? get style;

  @BuiltValueField(wireName: r'subcategory')
  ColorAnalysisResponseColorProfileContrastLevel? get subcategory;

  OutfitDetailItemItem._();

  factory OutfitDetailItemItem([void updates(OutfitDetailItemItemBuilder b)]) = _$OutfitDetailItemItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitDetailItemItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitDetailItemItem> get serializer => _$OutfitDetailItemItemSerializer();
}

class _$OutfitDetailItemItemSerializer implements PrimitiveSerializer<OutfitDetailItemItem> {
  @override
  final Iterable<Type> types = const [OutfitDetailItemItem, _$OutfitDetailItemItem];

  @override
  final String wireName = r'OutfitDetailItemItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitDetailItemItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'category';
    yield serializers.serialize(object.category, specifiedType: const FullType(String));
    yield r'colors';
    yield serializers.serialize(object.colors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'images';
    yield serializers.serialize(object.images, specifiedType: const FullType(BuiltList, [FullType(ImageObject)]));
    yield r'material';
    yield object.material == null
        ? null
        : serializers.serialize(
            object.material,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'season';
    yield serializers.serialize(object.season, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'style';
    yield object.style == null
        ? null
        : serializers.serialize(
            object.style,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'subcategory';
    yield object.subcategory == null
        ? null
        : serializers.serialize(
            object.subcategory,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitDetailItemItem object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitDetailItemItemBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'category':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.category = valueDes;
          break;
        case r'colors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.colors.replace(valueDes);
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'images':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ImageObject)]),
          ) as BuiltList<ImageObject>;
          result.images.replace(valueDes);
          break;
        case r'material':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.material.replace(valueDes);
          break;
        case r'season':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.season.replace(valueDes);
          break;
        case r'style':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.style.replace(valueDes);
          break;
        case r'subcategory':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.subcategory.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitDetailItemItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitDetailItemItemBuilder();
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
