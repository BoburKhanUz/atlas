//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_feedback_request.g.dart';

/// OutfitFeedbackRequest
///
/// Properties:
/// * [feedback]
/// * [note]
@BuiltValue()
abstract class OutfitFeedbackRequest implements Built<OutfitFeedbackRequest, OutfitFeedbackRequestBuilder> {
  @BuiltValueField(wireName: r'feedback')
  OutfitFeedbackRequestFeedbackEnum get feedback;
  // enum feedbackEnum {  liked,  disliked,  saved,  rejected,  };

  @BuiltValueField(wireName: r'note')
  String? get note;

  OutfitFeedbackRequest._();

  factory OutfitFeedbackRequest([void updates(OutfitFeedbackRequestBuilder b)]) = _$OutfitFeedbackRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitFeedbackRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitFeedbackRequest> get serializer => _$OutfitFeedbackRequestSerializer();
}

class _$OutfitFeedbackRequestSerializer implements PrimitiveSerializer<OutfitFeedbackRequest> {
  @override
  final Iterable<Type> types = const [OutfitFeedbackRequest, _$OutfitFeedbackRequest];

  @override
  final String wireName = r'OutfitFeedbackRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitFeedbackRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'feedback';
    yield serializers.serialize(object.feedback, specifiedType: const FullType(OutfitFeedbackRequestFeedbackEnum));
    if (object.note != null) {
      yield r'note';
      yield serializers.serialize(object.note, specifiedType: const FullType(String));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitFeedbackRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitFeedbackRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'feedback':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitFeedbackRequestFeedbackEnum),
          ) as OutfitFeedbackRequestFeedbackEnum;
          result.feedback = valueDes;
          break;
        case r'note':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.note = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitFeedbackRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitFeedbackRequestBuilder();
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

class OutfitFeedbackRequestFeedbackEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'liked')
  static const OutfitFeedbackRequestFeedbackEnum liked = _$outfitFeedbackRequestFeedbackEnum_liked;
  @BuiltValueEnumConst(wireName: r'disliked')
  static const OutfitFeedbackRequestFeedbackEnum disliked = _$outfitFeedbackRequestFeedbackEnum_disliked;
  @BuiltValueEnumConst(wireName: r'saved')
  static const OutfitFeedbackRequestFeedbackEnum saved = _$outfitFeedbackRequestFeedbackEnum_saved;
  @BuiltValueEnumConst(wireName: r'rejected')
  static const OutfitFeedbackRequestFeedbackEnum rejected = _$outfitFeedbackRequestFeedbackEnum_rejected;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const OutfitFeedbackRequestFeedbackEnum unknownDefaultOpenApi =
      _$outfitFeedbackRequestFeedbackEnum_unknownDefaultOpenApi;

  static Serializer<OutfitFeedbackRequestFeedbackEnum> get serializer => _$outfitFeedbackRequestFeedbackEnumSerializer;

  const OutfitFeedbackRequestFeedbackEnum._(String name) : super(name);

  static BuiltSet<OutfitFeedbackRequestFeedbackEnum> get values => _$outfitFeedbackRequestFeedbackEnumValues;
  static OutfitFeedbackRequestFeedbackEnum valueOf(String name) => _$outfitFeedbackRequestFeedbackEnumValueOf(name);
}
