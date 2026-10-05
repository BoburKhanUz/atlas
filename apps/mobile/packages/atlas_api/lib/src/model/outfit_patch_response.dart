//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_row.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_patch_response.g.dart';

/// OutfitPatchResponse
///
/// Properties:
/// * [outfit]
@BuiltValue()
abstract class OutfitPatchResponse implements Built<OutfitPatchResponse, OutfitPatchResponseBuilder> {
  @BuiltValueField(wireName: r'outfit')
  OutfitRow get outfit;

  OutfitPatchResponse._();

  factory OutfitPatchResponse([void updates(OutfitPatchResponseBuilder b)]) = _$OutfitPatchResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitPatchResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitPatchResponse> get serializer => _$OutfitPatchResponseSerializer();
}

class _$OutfitPatchResponseSerializer implements PrimitiveSerializer<OutfitPatchResponse> {
  @override
  final Iterable<Type> types = const [OutfitPatchResponse, _$OutfitPatchResponse];

  @override
  final String wireName = r'OutfitPatchResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitPatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'outfit';
    yield serializers.serialize(object.outfit, specifiedType: const FullType(OutfitRow));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitPatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitPatchResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'outfit':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(OutfitRow)) as OutfitRow;
          result.outfit.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitPatchResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitPatchResponseBuilder();
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
