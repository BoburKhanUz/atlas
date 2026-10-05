//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'conversation_response_conversation_messages_inner.g.dart';

/// ConversationResponseConversationMessagesInner
///
/// Properties:
/// * [content]
/// * [createdAt] - ISO 8601, UTC
/// * [id]
/// * [role]
@BuiltValue()
abstract class ConversationResponseConversationMessagesInner
    implements
        Built<ConversationResponseConversationMessagesInner, ConversationResponseConversationMessagesInnerBuilder> {
  @BuiltValueField(wireName: r'content')
  String get content;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'role')
  String get role;

  ConversationResponseConversationMessagesInner._();

  factory ConversationResponseConversationMessagesInner([
    void updates(ConversationResponseConversationMessagesInnerBuilder b),
  ]) = _$ConversationResponseConversationMessagesInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ConversationResponseConversationMessagesInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ConversationResponseConversationMessagesInner> get serializer =>
      _$ConversationResponseConversationMessagesInnerSerializer();
}

class _$ConversationResponseConversationMessagesInnerSerializer
    implements PrimitiveSerializer<ConversationResponseConversationMessagesInner> {
  @override
  final Iterable<Type> types = const [
    ConversationResponseConversationMessagesInner,
    _$ConversationResponseConversationMessagesInner,
  ];

  @override
  final String wireName = r'ConversationResponseConversationMessagesInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ConversationResponseConversationMessagesInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'content';
    yield serializers.serialize(object.content, specifiedType: const FullType(String));
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'role';
    yield serializers.serialize(object.role, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    ConversationResponseConversationMessagesInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ConversationResponseConversationMessagesInnerBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'content':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.content = valueDes;
          break;
        case r'createdAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.createdAt = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'role':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.role = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ConversationResponseConversationMessagesInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ConversationResponseConversationMessagesInnerBuilder();
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
