//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_save_response_outfit_items_inner.g.dart';

/// OutfitSaveResponseOutfitItemsInner
///
/// Properties:
/// * [id]
/// * [role]
/// * [wardrobeItemId]
@BuiltValue()
abstract class OutfitSaveResponseOutfitItemsInner
    implements Built<OutfitSaveResponseOutfitItemsInner, OutfitSaveResponseOutfitItemsInnerBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'role')
  String? get role;

  @BuiltValueField(wireName: r'wardrobeItemId')
  String get wardrobeItemId;

  OutfitSaveResponseOutfitItemsInner._();

  factory OutfitSaveResponseOutfitItemsInner([void updates(OutfitSaveResponseOutfitItemsInnerBuilder b)]) =
      _$OutfitSaveResponseOutfitItemsInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSaveResponseOutfitItemsInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSaveResponseOutfitItemsInner> get serializer =>
      _$OutfitSaveResponseOutfitItemsInnerSerializer();
}

class _$OutfitSaveResponseOutfitItemsInnerSerializer
    implements PrimitiveSerializer<OutfitSaveResponseOutfitItemsInner> {
  @override
  final Iterable<Type> types = const [OutfitSaveResponseOutfitItemsInner, _$OutfitSaveResponseOutfitItemsInner];

  @override
  final String wireName = r'OutfitSaveResponseOutfitItemsInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSaveResponseOutfitItemsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'role';
    yield object.role == null
        ? null
        : serializers.serialize(object.role, specifiedType: const FullType.nullable(String));
    yield r'wardrobeItemId';
    yield serializers.serialize(object.wardrobeItemId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitSaveResponseOutfitItemsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSaveResponseOutfitItemsInnerBuilder result,
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
        case r'role':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.role = valueDes;
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
  OutfitSaveResponseOutfitItemsInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSaveResponseOutfitItemsInnerBuilder();
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
