//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/preferences_row.dart';
import 'package:atlas_api/src/model/profile_row.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_user.g.dart';

/// ProfileUser
///
/// Properties:
/// * [createdAt] - ISO 8601, UTC
/// * [email]
/// * [id]
/// * [name]
/// * [preferences]
/// * [profile]
@BuiltValue()
abstract class ProfileUser implements Built<ProfileUser, ProfileUserBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'email')
  String get email;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'preferences')
  PreferencesRow? get preferences;

  @BuiltValueField(wireName: r'profile')
  ProfileRow? get profile;

  ProfileUser._();

  factory ProfileUser([void updates(ProfileUserBuilder b)]) = _$ProfileUser;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfileUserBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfileUser> get serializer => _$ProfileUserSerializer();
}

class _$ProfileUserSerializer implements PrimitiveSerializer<ProfileUser> {
  @override
  final Iterable<Type> types = const [ProfileUser, _$ProfileUser];

  @override
  final String wireName = r'ProfileUser';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfileUser object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'email';
    yield serializers.serialize(object.email, specifiedType: const FullType(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'name';
    yield object.name == null
        ? null
        : serializers.serialize(object.name, specifiedType: const FullType.nullable(String));
    yield r'preferences';
    yield object.preferences == null
        ? null
        : serializers.serialize(object.preferences, specifiedType: const FullType.nullable(PreferencesRow));
    yield r'profile';
    yield object.profile == null
        ? null
        : serializers.serialize(object.profile, specifiedType: const FullType.nullable(ProfileRow));
  }

  @override
  Object serialize(Serializers serializers, ProfileUser object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfileUserBuilder result,
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
        case r'preferences':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(PreferencesRow)) as PreferencesRow?;
          if (valueDes == null) continue;
          result.preferences.replace(valueDes);
          break;
        case r'profile':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(ProfileRow)) as ProfileRow?;
          if (valueDes == null) continue;
          result.profile.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProfileUser deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = ProfileUserBuilder();
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
