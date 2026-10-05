//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/outfit_summary.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_list_response.g.dart';

/// OutfitListResponse
///
/// Properties:
/// * [outfits]
@BuiltValue()
abstract class OutfitListResponse implements Built<OutfitListResponse, OutfitListResponseBuilder> {
  @BuiltValueField(wireName: r'outfits')
  BuiltList<OutfitSummary> get outfits;

  OutfitListResponse._();

  factory OutfitListResponse([void updates(OutfitListResponseBuilder b)]) = _$OutfitListResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitListResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitListResponse> get serializer => _$OutfitListResponseSerializer();
}

class _$OutfitListResponseSerializer implements PrimitiveSerializer<OutfitListResponse> {
  @override
  final Iterable<Type> types = const [OutfitListResponse, _$OutfitListResponse];

  @override
  final String wireName = r'OutfitListResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitListResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'outfits';
    yield serializers.serialize(object.outfits, specifiedType: const FullType(BuiltList, [FullType(OutfitSummary)]));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitListResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitListResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'outfits':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(OutfitSummary)]),
          ) as BuiltList<OutfitSummary>;
          result.outfits.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitListResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitListResponseBuilder();
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
