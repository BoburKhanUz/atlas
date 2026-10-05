//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/image_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_summary_item.g.dart';

/// OutfitSummaryItem
///
/// Properties:
/// * [category]
/// * [colors]
/// * [id]
/// * [image]
/// * [material]
/// * [role]
/// * [season]
/// * [style]
/// * [subcategory]
@BuiltValue()
abstract class OutfitSummaryItem implements Built<OutfitSummaryItem, OutfitSummaryItemBuilder> {
  @BuiltValueField(wireName: r'category')
  String get category;

  @BuiltValueField(wireName: r'colors')
  BuiltList<String> get colors;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'image')
  ImageObject? get image;

  @BuiltValueField(wireName: r'material')
  String? get material;

  @BuiltValueField(wireName: r'role')
  String? get role;

  @BuiltValueField(wireName: r'season')
  BuiltList<String> get season;

  @BuiltValueField(wireName: r'style')
  String? get style;

  @BuiltValueField(wireName: r'subcategory')
  String? get subcategory;

  OutfitSummaryItem._();

  factory OutfitSummaryItem([void updates(OutfitSummaryItemBuilder b)]) = _$OutfitSummaryItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSummaryItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSummaryItem> get serializer => _$OutfitSummaryItemSerializer();
}

class _$OutfitSummaryItemSerializer implements PrimitiveSerializer<OutfitSummaryItem> {
  @override
  final Iterable<Type> types = const [OutfitSummaryItem, _$OutfitSummaryItem];

  @override
  final String wireName = r'OutfitSummaryItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSummaryItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'category';
    yield serializers.serialize(object.category, specifiedType: const FullType(String));
    yield r'colors';
    yield serializers.serialize(object.colors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'image';
    yield object.image == null
        ? null
        : serializers.serialize(object.image, specifiedType: const FullType.nullable(ImageObject));
    yield r'material';
    yield object.material == null
        ? null
        : serializers.serialize(object.material, specifiedType: const FullType.nullable(String));
    yield r'role';
    yield object.role == null
        ? null
        : serializers.serialize(object.role, specifiedType: const FullType.nullable(String));
    yield r'season';
    yield serializers.serialize(object.season, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'style';
    yield object.style == null
        ? null
        : serializers.serialize(object.style, specifiedType: const FullType.nullable(String));
    yield r'subcategory';
    yield object.subcategory == null
        ? null
        : serializers.serialize(object.subcategory, specifiedType: const FullType.nullable(String));
  }

  @override
  Object serialize(Serializers serializers, OutfitSummaryItem object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSummaryItemBuilder result,
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
        case r'image':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(ImageObject)) as ImageObject?;
          if (valueDes == null) continue;
          result.image.replace(valueDes);
          break;
        case r'material':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.material = valueDes;
          break;
        case r'role':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.role = valueDes;
          break;
        case r'season':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.season.replace(valueDes);
          break;
        case r'style':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.style = valueDes;
          break;
        case r'subcategory':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.subcategory = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitSummaryItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSummaryItemBuilder();
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
