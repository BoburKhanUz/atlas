//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'session_user.g.dart';

/// SessionUser
///
/// Properties:
/// * [email]
/// * [id]
/// * [name]
@BuiltValue()
abstract class SessionUser implements Built<SessionUser, SessionUserBuilder> {
  @BuiltValueField(wireName: r'email')
  String get email;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'name')
  String? get name;

  SessionUser._();

  factory SessionUser([void updates(SessionUserBuilder b)]) = _$SessionUser;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(SessionUserBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<SessionUser> get serializer => _$SessionUserSerializer();
}

class _$SessionUserSerializer implements PrimitiveSerializer<SessionUser> {
  @override
  final Iterable<Type> types = const [SessionUser, _$SessionUser];

  @override
  final String wireName = r'SessionUser';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    SessionUser object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'email';
    yield serializers.serialize(object.email, specifiedType: const FullType(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'name';
    yield object.name == null
        ? null
        : serializers.serialize(object.name, specifiedType: const FullType.nullable(String));
  }

  @override
  Object serialize(Serializers serializers, SessionUser object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required SessionUserBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'email':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.email = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  SessionUser deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = SessionUserBuilder();
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
