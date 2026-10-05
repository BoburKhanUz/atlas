//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/outfit_save_response_outfit_items_inner.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_save_response_outfit.g.dart';

/// OutfitSaveResponseOutfit
///
/// Properties:
/// * [createdAt] - ISO 8601, UTC
/// * [explanation]
/// * [id]
/// * [isSaved]
/// * [items]
/// * [name]
/// * [occasion]
/// * [score]
/// * [updatedAt] - ISO 8601, UTC
@BuiltValue()
abstract class OutfitSaveResponseOutfit implements Built<OutfitSaveResponseOutfit, OutfitSaveResponseOutfitBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'explanation')
  String? get explanation;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'isSaved')
  bool get isSaved;

  @BuiltValueField(wireName: r'items')
  BuiltList<OutfitSaveResponseOutfitItemsInner> get items;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'occasion')
  String? get occasion;

  @BuiltValueField(wireName: r'score')
  int? get score;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'updatedAt')
  DateTime get updatedAt;

  OutfitSaveResponseOutfit._();

  factory OutfitSaveResponseOutfit([void updates(OutfitSaveResponseOutfitBuilder b)]) = _$OutfitSaveResponseOutfit;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSaveResponseOutfitBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSaveResponseOutfit> get serializer => _$OutfitSaveResponseOutfitSerializer();
}

class _$OutfitSaveResponseOutfitSerializer implements PrimitiveSerializer<OutfitSaveResponseOutfit> {
  @override
  final Iterable<Type> types = const [OutfitSaveResponseOutfit, _$OutfitSaveResponseOutfit];

  @override
  final String wireName = r'OutfitSaveResponseOutfit';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSaveResponseOutfit object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'explanation';
    yield object.explanation == null
        ? null
        : serializers.serialize(object.explanation, specifiedType: const FullType.nullable(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'isSaved';
    yield serializers.serialize(object.isSaved, specifiedType: const FullType(bool));
    yield r'items';
    yield serializers.serialize(
      object.items,
      specifiedType: const FullType(BuiltList, [FullType(OutfitSaveResponseOutfitItemsInner)]),
    );
    yield r'name';
    yield object.name == null
        ? null
        : serializers.serialize(object.name, specifiedType: const FullType.nullable(String));
    yield r'occasion';
    yield object.occasion == null
        ? null
        : serializers.serialize(object.occasion, specifiedType: const FullType.nullable(String));
    yield r'score';
    yield object.score == null
        ? null
        : serializers.serialize(object.score, specifiedType: const FullType.nullable(int));
    yield r'updatedAt';
    yield serializers.serialize(object.updatedAt, specifiedType: const FullType(DateTime));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitSaveResponseOutfit object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSaveResponseOutfitBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'createdAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.createdAt = valueDes;
          break;
        case r'explanation':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.explanation = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'isSaved':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.isSaved = valueDes;
          break;
        case r'items':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(OutfitSaveResponseOutfitItemsInner)]),
          ) as BuiltList<OutfitSaveResponseOutfitItemsInner>;
          result.items.replace(valueDes);
          break;
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        case r'occasion':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.occasion = valueDes;
          break;
        case r'score':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(int)) as int?;
          if (valueDes == null) continue;
          result.score = valueDes;
          break;
        case r'updatedAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.updatedAt = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitSaveResponseOutfit deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSaveResponseOutfitBuilder();
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
