//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_detail.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_detail_response.g.dart';

/// OutfitDetailResponse
///
/// Properties:
/// * [outfit]
@BuiltValue()
abstract class OutfitDetailResponse implements Built<OutfitDetailResponse, OutfitDetailResponseBuilder> {
  @BuiltValueField(wireName: r'outfit')
  OutfitDetail get outfit;

  OutfitDetailResponse._();

  factory OutfitDetailResponse([void updates(OutfitDetailResponseBuilder b)]) = _$OutfitDetailResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitDetailResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitDetailResponse> get serializer => _$OutfitDetailResponseSerializer();
}

class _$OutfitDetailResponseSerializer implements PrimitiveSerializer<OutfitDetailResponse> {
  @override
  final Iterable<Type> types = const [OutfitDetailResponse, _$OutfitDetailResponse];

  @override
  final String wireName = r'OutfitDetailResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitDetailResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'outfit';
    yield serializers.serialize(object.outfit, specifiedType: const FullType(OutfitDetail));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitDetailResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitDetailResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'outfit':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(OutfitDetail)) as OutfitDetail;
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
  OutfitDetailResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitDetailResponseBuilder();
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
