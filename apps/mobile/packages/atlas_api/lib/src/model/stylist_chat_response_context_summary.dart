//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'stylist_chat_response_context_summary.g.dart';

/// StylistChatResponseContextSummary
///
/// Properties:
/// * [eventProvided]
/// * [wardrobeItemCount] - Wardrobe items given to the stylist for this answer (at most 40)
/// * [weatherProvided]
@BuiltValue()
abstract class StylistChatResponseContextSummary
    implements Built<StylistChatResponseContextSummary, StylistChatResponseContextSummaryBuilder> {
  @BuiltValueField(wireName: r'eventProvided')
  bool get eventProvided;

  /// Wardrobe items given to the stylist for this answer (at most 40)
  @BuiltValueField(wireName: r'wardrobeItemCount')
  int get wardrobeItemCount;

  @BuiltValueField(wireName: r'weatherProvided')
  bool get weatherProvided;

  StylistChatResponseContextSummary._();

  factory StylistChatResponseContextSummary([void updates(StylistChatResponseContextSummaryBuilder b)]) =
      _$StylistChatResponseContextSummary;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(StylistChatResponseContextSummaryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<StylistChatResponseContextSummary> get serializer =>
      _$StylistChatResponseContextSummarySerializer();
}

class _$StylistChatResponseContextSummarySerializer implements PrimitiveSerializer<StylistChatResponseContextSummary> {
  @override
  final Iterable<Type> types = const [StylistChatResponseContextSummary, _$StylistChatResponseContextSummary];

  @override
  final String wireName = r'StylistChatResponseContextSummary';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    StylistChatResponseContextSummary object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'eventProvided';
    yield serializers.serialize(object.eventProvided, specifiedType: const FullType(bool));
    yield r'wardrobeItemCount';
    yield serializers.serialize(object.wardrobeItemCount, specifiedType: const FullType(int));
    yield r'weatherProvided';
    yield serializers.serialize(object.weatherProvided, specifiedType: const FullType(bool));
  }

  @override
  Object serialize(
    Serializers serializers,
    StylistChatResponseContextSummary object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required StylistChatResponseContextSummaryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'eventProvided':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.eventProvided = valueDes;
          break;
        case r'wardrobeItemCount':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(int)) as int;
          result.wardrobeItemCount = valueDes;
          break;
        case r'weatherProvided':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.weatherProvided = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  StylistChatResponseContextSummary deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = StylistChatResponseContextSummaryBuilder();
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
