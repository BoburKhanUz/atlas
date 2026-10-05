//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_feedback_response_feedback.g.dart';

/// OutfitFeedbackResponseFeedback
///
/// Properties:
/// * [createdAt] - ISO 8601, UTC
/// * [feedback]
/// * [id]
/// * [note]
/// * [outfitId]
@BuiltValue()
abstract class OutfitFeedbackResponseFeedback
    implements Built<OutfitFeedbackResponseFeedback, OutfitFeedbackResponseFeedbackBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'feedback')
  String get feedback;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'note')
  String? get note;

  @BuiltValueField(wireName: r'outfitId')
  String get outfitId;

  OutfitFeedbackResponseFeedback._();

  factory OutfitFeedbackResponseFeedback([void updates(OutfitFeedbackResponseFeedbackBuilder b)]) =
      _$OutfitFeedbackResponseFeedback;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitFeedbackResponseFeedbackBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitFeedbackResponseFeedback> get serializer => _$OutfitFeedbackResponseFeedbackSerializer();
}

class _$OutfitFeedbackResponseFeedbackSerializer implements PrimitiveSerializer<OutfitFeedbackResponseFeedback> {
  @override
  final Iterable<Type> types = const [OutfitFeedbackResponseFeedback, _$OutfitFeedbackResponseFeedback];

  @override
  final String wireName = r'OutfitFeedbackResponseFeedback';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitFeedbackResponseFeedback object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'feedback';
    yield serializers.serialize(object.feedback, specifiedType: const FullType(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'note';
    yield object.note == null
        ? null
        : serializers.serialize(object.note, specifiedType: const FullType.nullable(String));
    yield r'outfitId';
    yield serializers.serialize(object.outfitId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitFeedbackResponseFeedback object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitFeedbackResponseFeedbackBuilder result,
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
        case r'feedback':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.feedback = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'note':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.note = valueDes;
          break;
        case r'outfitId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.outfitId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitFeedbackResponseFeedback deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitFeedbackResponseFeedbackBuilder();
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
