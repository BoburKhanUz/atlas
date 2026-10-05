//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/conversation_response_conversation.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'conversation_response.g.dart';

/// ConversationResponse
///
/// Properties:
/// * [conversation]
@BuiltValue()
abstract class ConversationResponse implements Built<ConversationResponse, ConversationResponseBuilder> {
  @BuiltValueField(wireName: r'conversation')
  ConversationResponseConversation get conversation;

  ConversationResponse._();

  factory ConversationResponse([void updates(ConversationResponseBuilder b)]) = _$ConversationResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ConversationResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ConversationResponse> get serializer => _$ConversationResponseSerializer();
}

class _$ConversationResponseSerializer implements PrimitiveSerializer<ConversationResponse> {
  @override
  final Iterable<Type> types = const [ConversationResponse, _$ConversationResponse];

  @override
  final String wireName = r'ConversationResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ConversationResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'conversation';
    yield serializers.serialize(object.conversation, specifiedType: const FullType(ConversationResponseConversation));
  }

  @override
  Object serialize(
    Serializers serializers,
    ConversationResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ConversationResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'conversation':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ConversationResponseConversation),
          ) as ConversationResponseConversation;
          result.conversation.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ConversationResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ConversationResponseBuilder();
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
