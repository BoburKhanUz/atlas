//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'correction_log_entry.g.dart';

/// CorrectionLogEntry
///
/// Properties:
/// * [at] - ISO 8601, UTC
/// * [field]
/// * [from]
/// * [to]
@BuiltValue()
abstract class CorrectionLogEntry implements Built<CorrectionLogEntry, CorrectionLogEntryBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'at')
  DateTime get at;

  @BuiltValueField(wireName: r'field')
  String get field;

  @BuiltValueField(wireName: r'from')
  String get from;

  @BuiltValueField(wireName: r'to')
  String get to;

  CorrectionLogEntry._();

  factory CorrectionLogEntry([void updates(CorrectionLogEntryBuilder b)]) = _$CorrectionLogEntry;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CorrectionLogEntryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CorrectionLogEntry> get serializer => _$CorrectionLogEntrySerializer();
}

class _$CorrectionLogEntrySerializer implements PrimitiveSerializer<CorrectionLogEntry> {
  @override
  final Iterable<Type> types = const [CorrectionLogEntry, _$CorrectionLogEntry];

  @override
  final String wireName = r'CorrectionLogEntry';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CorrectionLogEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'at';
    yield serializers.serialize(object.at, specifiedType: const FullType(DateTime));
    yield r'field';
    yield serializers.serialize(object.field, specifiedType: const FullType(String));
    yield r'from';
    yield serializers.serialize(object.from, specifiedType: const FullType(String));
    yield r'to';
    yield serializers.serialize(object.to, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    CorrectionLogEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CorrectionLogEntryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'at':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.at = valueDes;
          break;
        case r'field':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.field = valueDes;
          break;
        case r'from':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.from = valueDes;
          break;
        case r'to':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.to = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CorrectionLogEntry deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CorrectionLogEntryBuilder();
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
