//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'conversation_list_response_conversations_inner.g.dart';

/// ConversationListResponseConversationsInner
///
/// Properties:
/// * [id]
/// * [lastMessage]
/// * [lastRole]
/// * [title]
/// * [updatedAt] - ISO 8601, UTC
@BuiltValue()
abstract class ConversationListResponseConversationsInner
    implements Built<ConversationListResponseConversationsInner, ConversationListResponseConversationsInnerBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'lastMessage')
  ColorAnalysisResponseColorProfileContrastLevel? get lastMessage;

  @BuiltValueField(wireName: r'lastRole')
  ColorAnalysisResponseColorProfileContrastLevel? get lastRole;

  @BuiltValueField(wireName: r'title')
  ColorAnalysisResponseColorProfileContrastLevel? get title;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'updatedAt')
  DateTime get updatedAt;

  ConversationListResponseConversationsInner._();

  factory ConversationListResponseConversationsInner([
    void updates(ConversationListResponseConversationsInnerBuilder b),
  ]) = _$ConversationListResponseConversationsInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ConversationListResponseConversationsInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ConversationListResponseConversationsInner> get serializer =>
      _$ConversationListResponseConversationsInnerSerializer();
}

class _$ConversationListResponseConversationsInnerSerializer
    implements PrimitiveSerializer<ConversationListResponseConversationsInner> {
  @override
  final Iterable<Type> types = const [
    ConversationListResponseConversationsInner,
    _$ConversationListResponseConversationsInner,
  ];

  @override
  final String wireName = r'ConversationListResponseConversationsInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ConversationListResponseConversationsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'lastMessage';
    yield object.lastMessage == null
        ? null
        : serializers.serialize(
            object.lastMessage,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
    yield r'lastRole';
    yield object.lastRole == null
        ? null
        : serializers.serialize(
            object.lastRole,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
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
    ConversationListResponseConversationsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ConversationListResponseConversationsInnerBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'lastMessage':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.lastMessage.replace(valueDes);
          break;
        case r'lastRole':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.lastRole.replace(valueDes);
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
  ConversationListResponseConversationsInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ConversationListResponseConversationsInnerBuilder();
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
