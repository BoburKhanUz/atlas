//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/correction_log_entry.dart';
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/wardrobe_item.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_patch_response.g.dart';

/// WardrobePatchResponse
///
/// Properties:
/// * [corrections]
/// * [item]
@BuiltValue()
abstract class WardrobePatchResponse implements Built<WardrobePatchResponse, WardrobePatchResponseBuilder> {
  @BuiltValueField(wireName: r'corrections')
  BuiltList<CorrectionLogEntry> get corrections;

  @BuiltValueField(wireName: r'item')
  WardrobeItem get item;

  WardrobePatchResponse._();

  factory WardrobePatchResponse([void updates(WardrobePatchResponseBuilder b)]) = _$WardrobePatchResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobePatchResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobePatchResponse> get serializer => _$WardrobePatchResponseSerializer();
}

class _$WardrobePatchResponseSerializer implements PrimitiveSerializer<WardrobePatchResponse> {
  @override
  final Iterable<Type> types = const [WardrobePatchResponse, _$WardrobePatchResponse];

  @override
  final String wireName = r'WardrobePatchResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobePatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'corrections';
    yield serializers.serialize(
      object.corrections,
      specifiedType: const FullType(BuiltList, [FullType(CorrectionLogEntry)]),
    );
    yield r'item';
    yield serializers.serialize(object.item, specifiedType: const FullType(WardrobeItem));
  }

  @override
  Object serialize(
    Serializers serializers,
    WardrobePatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobePatchResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'corrections':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(CorrectionLogEntry)]),
          ) as BuiltList<CorrectionLogEntry>;
          result.corrections.replace(valueDes);
          break;
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
  WardrobePatchResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobePatchResponseBuilder();
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
