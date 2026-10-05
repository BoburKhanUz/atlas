//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:atlas_api/src/model/conversation_response_conversation_messages_inner.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'conversation_response_conversation.g.dart';

/// ConversationResponseConversation
///
/// Properties:
/// * [createdAt] - ISO 8601, UTC
/// * [id]
/// * [messages]
/// * [title]
/// * [updatedAt] - ISO 8601, UTC
@BuiltValue()
abstract class ConversationResponseConversation
    implements Built<ConversationResponseConversation, ConversationResponseConversationBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'messages')
  BuiltList<ConversationResponseConversationMessagesInner> get messages;

  @BuiltValueField(wireName: r'title')
  ColorAnalysisResponseColorProfileContrastLevel? get title;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'updatedAt')
  DateTime get updatedAt;

  ConversationResponseConversation._();

  factory ConversationResponseConversation([void updates(ConversationResponseConversationBuilder b)]) =
      _$ConversationResponseConversation;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ConversationResponseConversationBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ConversationResponseConversation> get serializer => _$ConversationResponseConversationSerializer();
}

class _$ConversationResponseConversationSerializer implements PrimitiveSerializer<ConversationResponseConversation> {
  @override
  final Iterable<Type> types = const [ConversationResponseConversation, _$ConversationResponseConversation];

  @override
  final String wireName = r'ConversationResponseConversation';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ConversationResponseConversation object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'messages';
    yield serializers.serialize(
      object.messages,
      specifiedType: const FullType(BuiltList, [FullType(ConversationResponseConversationMessagesInner)]),
    );
    yield r'title';
    yield object.title == null
        ? null
        : serializers.serialize(
            object.title,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'updatedAt';
    yield serializers.serialize(object.updatedAt, specifiedType: const FullType(DateTime));
  }

  @override
  Object serialize(
    Serializers serializers,
    ConversationResponseConversation object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ConversationResponseConversationBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'createdAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.createdAt = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'messages':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ConversationResponseConversationMessagesInner)]),
          ) as BuiltList<ConversationResponseConversationMessagesInner>;
          result.messages.replace(valueDes);
          break;
        case r'title':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.title.replace(valueDes);
          break;
        case r'updatedAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.updatedAt = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ConversationResponseConversation deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ConversationResponseConversationBuilder();
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
