//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_patch_request.g.dart';

/// OutfitPatchRequest
///
/// Properties:
/// * [isSaved]
/// * [name]
@BuiltValue()
abstract class OutfitPatchRequest implements Built<OutfitPatchRequest, OutfitPatchRequestBuilder> {
  @BuiltValueField(wireName: r'isSaved')
  bool? get isSaved;

  @BuiltValueField(wireName: r'name')
  String? get name;

  OutfitPatchRequest._();

  factory OutfitPatchRequest([void updates(OutfitPatchRequestBuilder b)]) = _$OutfitPatchRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitPatchRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitPatchRequest> get serializer => _$OutfitPatchRequestSerializer();
}

class _$OutfitPatchRequestSerializer implements PrimitiveSerializer<OutfitPatchRequest> {
  @override
  final Iterable<Type> types = const [OutfitPatchRequest, _$OutfitPatchRequest];

  @override
  final String wireName = r'OutfitPatchRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitPatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.isSaved != null) {
      yield r'isSaved';
      yield serializers.serialize(object.isSaved, specifiedType: const FullType(bool));
    }
    if (object.name != null) {
      yield r'name';
      yield serializers.serialize(object.name, specifiedType: const FullType.nullable(String));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitPatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitPatchRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'isSaved':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.isSaved = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitPatchRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitPatchRequestBuilder();
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
