//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/wardrobe_item.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_item_response.g.dart';

/// WardrobeItemResponse
///
/// Properties:
/// * [item]
@BuiltValue()
abstract class WardrobeItemResponse implements Built<WardrobeItemResponse, WardrobeItemResponseBuilder> {
  @BuiltValueField(wireName: r'item')
  WardrobeItem get item;

  WardrobeItemResponse._();

  factory WardrobeItemResponse([void updates(WardrobeItemResponseBuilder b)]) = _$WardrobeItemResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeItemResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeItemResponse> get serializer => _$WardrobeItemResponseSerializer();
}

class _$WardrobeItemResponseSerializer implements PrimitiveSerializer<WardrobeItemResponse> {
  @override
  final Iterable<Type> types = const [WardrobeItemResponse, _$WardrobeItemResponse];

  @override
  final String wireName = r'WardrobeItemResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeItemResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'item';
    yield serializers.serialize(object.item, specifiedType: const FullType(WardrobeItem));
  }

  @override
  Object serialize(
    Serializers serializers,
    WardrobeItemResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeItemResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'item':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(WardrobeItem)) as WardrobeItem;
          result.item.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeItemResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeItemResponseBuilder();
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
