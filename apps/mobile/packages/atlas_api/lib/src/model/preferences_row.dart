//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'preferences_row.g.dart';

/// UserPreferences row (list fields as JSON strings)
///
/// Properties:
/// * [id]
/// * [language]
/// * [userId]
@BuiltValue()
abstract class PreferencesRow implements Built<PreferencesRow, PreferencesRowBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'language')
  String get language;

  @BuiltValueField(wireName: r'userId')
  String get userId;

  PreferencesRow._();

  factory PreferencesRow([void updates(PreferencesRowBuilder b)]) = _$PreferencesRow;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PreferencesRowBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PreferencesRow> get serializer => _$PreferencesRowSerializer();
}

class _$PreferencesRowSerializer implements PrimitiveSerializer<PreferencesRow> {
  @override
  final Iterable<Type> types = const [PreferencesRow, _$PreferencesRow];

  @override
  final String wireName = r'PreferencesRow';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PreferencesRow object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'language';
    yield serializers.serialize(object.language, specifiedType: const FullType(String));
    yield r'userId';
    yield serializers.serialize(object.userId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, PreferencesRow object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PreferencesRowBuilder result,
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
        case r'language':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.language = valueDes;
          break;
        case r'userId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.userId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PreferencesRow deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PreferencesRowBuilder();
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
