//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/outfit_feedback_response_feedback.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_feedback_response.g.dart';

/// OutfitFeedbackResponse
///
/// Properties:
/// * [feedback]
@BuiltValue()
abstract class OutfitFeedbackResponse implements Built<OutfitFeedbackResponse, OutfitFeedbackResponseBuilder> {
  @BuiltValueField(wireName: r'feedback')
  OutfitFeedbackResponseFeedback get feedback;

  OutfitFeedbackResponse._();

  factory OutfitFeedbackResponse([void updates(OutfitFeedbackResponseBuilder b)]) = _$OutfitFeedbackResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitFeedbackResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitFeedbackResponse> get serializer => _$OutfitFeedbackResponseSerializer();
}

class _$OutfitFeedbackResponseSerializer implements PrimitiveSerializer<OutfitFeedbackResponse> {
  @override
  final Iterable<Type> types = const [OutfitFeedbackResponse, _$OutfitFeedbackResponse];

  @override
  final String wireName = r'OutfitFeedbackResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitFeedbackResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'feedback';
    yield serializers.serialize(object.feedback, specifiedType: const FullType(OutfitFeedbackResponseFeedback));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitFeedbackResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitFeedbackResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'feedback':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitFeedbackResponseFeedback),
          ) as OutfitFeedbackResponseFeedback;
          result.feedback.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitFeedbackResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitFeedbackResponseBuilder();
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
