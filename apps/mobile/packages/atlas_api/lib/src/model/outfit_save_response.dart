//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_save_response_outfit.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_save_response.g.dart';

/// OutfitSaveResponse
///
/// Properties:
/// * [outfit]
@BuiltValue()
abstract class OutfitSaveResponse implements Built<OutfitSaveResponse, OutfitSaveResponseBuilder> {
  @BuiltValueField(wireName: r'outfit')
  OutfitSaveResponseOutfit get outfit;

  OutfitSaveResponse._();

  factory OutfitSaveResponse([void updates(OutfitSaveResponseBuilder b)]) = _$OutfitSaveResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSaveResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSaveResponse> get serializer => _$OutfitSaveResponseSerializer();
}

class _$OutfitSaveResponseSerializer implements PrimitiveSerializer<OutfitSaveResponse> {
  @override
  final Iterable<Type> types = const [OutfitSaveResponse, _$OutfitSaveResponse];

  @override
  final String wireName = r'OutfitSaveResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSaveResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'outfit';
    yield serializers.serialize(object.outfit, specifiedType: const FullType(OutfitSaveResponseOutfit));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitSaveResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSaveResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'outfit':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitSaveResponseOutfit),
          ) as OutfitSaveResponseOutfit;
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
  OutfitSaveResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSaveResponseBuilder();
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
