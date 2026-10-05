//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/wardrobe_item.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_list_response.g.dart';

/// WardrobeListResponse
///
/// Properties:
/// * [items]
/// * [nextCursor]
@BuiltValue()
abstract class WardrobeListResponse implements Built<WardrobeListResponse, WardrobeListResponseBuilder> {
  @BuiltValueField(wireName: r'items')
  BuiltList<WardrobeItem> get items;

  @BuiltValueField(wireName: r'nextCursor')
  String? get nextCursor;

  WardrobeListResponse._();

  factory WardrobeListResponse([void updates(WardrobeListResponseBuilder b)]) = _$WardrobeListResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeListResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeListResponse> get serializer => _$WardrobeListResponseSerializer();
}

class _$WardrobeListResponseSerializer implements PrimitiveSerializer<WardrobeListResponse> {
  @override
  final Iterable<Type> types = const [WardrobeListResponse, _$WardrobeListResponse];

  @override
  final String wireName = r'WardrobeListResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeListResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'items';
    yield serializers.serialize(object.items, specifiedType: const FullType(BuiltList, [FullType(WardrobeItem)]));
    yield r'nextCursor';
    yield object.nextCursor == null
        ? null
        : serializers.serialize(object.nextCursor, specifiedType: const FullType.nullable(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    WardrobeListResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeListResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'items':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(WardrobeItem)]),
          ) as BuiltList<WardrobeItem>;
          result.items.replace(valueDes);
          break;
        case r'nextCursor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.nextCursor = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeListResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeListResponseBuilder();
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
