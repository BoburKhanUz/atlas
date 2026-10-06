//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_save_request_items_inner.g.dart';

/// OutfitSaveRequestItemsInner
///
/// Properties:
/// * [itemId]
/// * [role] - top, bottom, shoes or accessory (legacy roles), or dress, outerwear, footwear; must match the item category (validated)
@BuiltValue()
abstract class OutfitSaveRequestItemsInner
    implements Built<OutfitSaveRequestItemsInner, OutfitSaveRequestItemsInnerBuilder> {
  @BuiltValueField(wireName: r'itemId')
  String get itemId;

  /// top, bottom, shoes or accessory (legacy roles), or dress, outerwear, footwear; must match the item category (validated)
  @BuiltValueField(wireName: r'role')
  String get role;

  OutfitSaveRequestItemsInner._();

  factory OutfitSaveRequestItemsInner([void updates(OutfitSaveRequestItemsInnerBuilder b)]) =
      _$OutfitSaveRequestItemsInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSaveRequestItemsInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSaveRequestItemsInner> get serializer => _$OutfitSaveRequestItemsInnerSerializer();
}

class _$OutfitSaveRequestItemsInnerSerializer implements PrimitiveSerializer<OutfitSaveRequestItemsInner> {
  @override
  final Iterable<Type> types = const [OutfitSaveRequestItemsInner, _$OutfitSaveRequestItemsInner];

  @override
  final String wireName = r'OutfitSaveRequestItemsInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSaveRequestItemsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'itemId';
    yield serializers.serialize(object.itemId, specifiedType: const FullType(String));
    yield r'role';
    yield serializers.serialize(object.role, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitSaveRequestItemsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSaveRequestItemsInnerBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'itemId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.itemId = valueDes;
          break;
        case r'role':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.role = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitSaveRequestItemsInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSaveRequestItemsInnerBuilder();
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
