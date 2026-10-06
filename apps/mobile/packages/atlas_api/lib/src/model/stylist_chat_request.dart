//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/stylist_chat_request_weather.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'stylist_chat_request.g.dart';

/// StylistChatRequest
///
/// Properties:
/// * [conversationId]
/// * [event]
/// * [message] - Trimmed; 1–2000 characters
/// * [weather]
@BuiltValue()
abstract class StylistChatRequest implements Built<StylistChatRequest, StylistChatRequestBuilder> {
  @BuiltValueField(wireName: r'conversationId')
  String? get conversationId;

  @BuiltValueField(wireName: r'event')
  String? get event;

  /// Trimmed; 1–2000 characters
  @BuiltValueField(wireName: r'message')
  String get message;

  @BuiltValueField(wireName: r'weather')
  StylistChatRequestWeather? get weather;

  StylistChatRequest._();

  factory StylistChatRequest([void updates(StylistChatRequestBuilder b)]) = _$StylistChatRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(StylistChatRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<StylistChatRequest> get serializer => _$StylistChatRequestSerializer();
}

class _$StylistChatRequestSerializer implements PrimitiveSerializer<StylistChatRequest> {
  @override
  final Iterable<Type> types = const [StylistChatRequest, _$StylistChatRequest];

  @override
  final String wireName = r'StylistChatRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    StylistChatRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.conversationId != null) {
      yield r'conversationId';
      yield serializers.serialize(object.conversationId, specifiedType: const FullType.nullable(String));
    }
    if (object.event != null) {
      yield r'event';
      yield serializers.serialize(object.event, specifiedType: const FullType.nullable(String));
    }
    yield r'message';
    yield serializers.serialize(object.message, specifiedType: const FullType(String));
    if (object.weather != null) {
      yield r'weather';
      yield serializers.serialize(object.weather, specifiedType: const FullType.nullable(StylistChatRequestWeather));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    StylistChatRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required StylistChatRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'conversationId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.conversationId = valueDes;
          break;
        case r'event':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.event = valueDes;
          break;
        case r'message':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.message = valueDes;
          break;
        case r'weather':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(StylistChatRequestWeather),
          ) as StylistChatRequestWeather?;
          if (valueDes == null) continue;
          result.weather.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  StylistChatRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = StylistChatRequestBuilder();
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
