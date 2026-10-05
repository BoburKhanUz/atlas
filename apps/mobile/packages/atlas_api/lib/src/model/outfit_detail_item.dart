//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:atlas_api/src/model/outfit_detail_item_item.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_detail_item.g.dart';

/// OutfitDetailItem
///
/// Properties:
/// * [id]
/// * [item]
/// * [role]
/// * [wardrobeItemId]
@BuiltValue()
abstract class OutfitDetailItem implements Built<OutfitDetailItem, OutfitDetailItemBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'item')
  OutfitDetailItemItem get item;

  @BuiltValueField(wireName: r'role')
  ColorAnalysisResponseColorProfileContrastLevel? get role;

  @BuiltValueField(wireName: r'wardrobeItemId')
  String get wardrobeItemId;

  OutfitDetailItem._();

  factory OutfitDetailItem([void updates(OutfitDetailItemBuilder b)]) = _$OutfitDetailItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitDetailItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitDetailItem> get serializer => _$OutfitDetailItemSerializer();
}

class _$OutfitDetailItemSerializer implements PrimitiveSerializer<OutfitDetailItem> {
  @override
  final Iterable<Type> types = const [OutfitDetailItem, _$OutfitDetailItem];

  @override
  final String wireName = r'OutfitDetailItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitDetailItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'item';
    yield serializers.serialize(object.item, specifiedType: const FullType(OutfitDetailItemItem));
    yield r'role';
    yield object.role == null
        ? null
        : serializers.serialize(
            object.role,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'wardrobeItemId';
    yield serializers.serialize(object.wardrobeItemId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, OutfitDetailItem object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitDetailItemBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'item':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitDetailItemItem),
          ) as OutfitDetailItemItem;
          result.item.replace(valueDes);
          break;
        case r'role':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.role.replace(valueDes);
          break;
        case r'wardrobeItemId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.wardrobeItemId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitDetailItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitDetailItemBuilder();
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
