//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/stylist_chat_response_context_summary.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'stylist_chat_response.g.dart';

/// StylistChatResponse
///
/// Properties:
/// * [assistantMessage] - The stylist answer; wardrobe items are named in plain words (no internal references or ids)
/// * [contextSummary]
/// * [conversationId]
@BuiltValue()
abstract class StylistChatResponse implements Built<StylistChatResponse, StylistChatResponseBuilder> {
  /// The stylist answer; wardrobe items are named in plain words (no internal references or ids)
  @BuiltValueField(wireName: r'assistantMessage')
  String get assistantMessage;

  @BuiltValueField(wireName: r'contextSummary')
  StylistChatResponseContextSummary get contextSummary;

  @BuiltValueField(wireName: r'conversationId')
  String get conversationId;

  StylistChatResponse._();

  factory StylistChatResponse([void updates(StylistChatResponseBuilder b)]) = _$StylistChatResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(StylistChatResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<StylistChatResponse> get serializer => _$StylistChatResponseSerializer();
}

class _$StylistChatResponseSerializer implements PrimitiveSerializer<StylistChatResponse> {
  @override
  final Iterable<Type> types = const [StylistChatResponse, _$StylistChatResponse];

  @override
  final String wireName = r'StylistChatResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    StylistChatResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'assistantMessage';
    yield serializers.serialize(object.assistantMessage, specifiedType: const FullType(String));
    yield r'contextSummary';
    yield serializers.serialize(
      object.contextSummary,
      specifiedType: const FullType(StylistChatResponseContextSummary),
    );
    yield r'conversationId';
    yield serializers.serialize(object.conversationId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    StylistChatResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required StylistChatResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'assistantMessage':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.assistantMessage = valueDes;
          break;
        case r'contextSummary':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(StylistChatResponseContextSummary),
          ) as StylistChatResponseContextSummary;
          result.contextSummary.replace(valueDes);
          break;
        case r'conversationId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.conversationId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  StylistChatResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = StylistChatResponseBuilder();
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
