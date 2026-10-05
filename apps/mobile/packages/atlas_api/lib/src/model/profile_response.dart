//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/profile_preferences.dart';
import 'package:atlas_api/src/model/profile_row.dart';
import 'package:atlas_api/src/model/profile_user.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_response.g.dart';

/// ProfileResponse
///
/// Properties:
/// * [preferences]
/// * [profile]
/// * [user]
@BuiltValue()
abstract class ProfileResponse implements Built<ProfileResponse, ProfileResponseBuilder> {
  @BuiltValueField(wireName: r'preferences')
  ProfilePreferences? get preferences;

  @BuiltValueField(wireName: r'profile')
  ProfileRow? get profile;

  @BuiltValueField(wireName: r'user')
  ProfileUser get user;

  ProfileResponse._();

  factory ProfileResponse([void updates(ProfileResponseBuilder b)]) = _$ProfileResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfileResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfileResponse> get serializer => _$ProfileResponseSerializer();
}

class _$ProfileResponseSerializer implements PrimitiveSerializer<ProfileResponse> {
  @override
  final Iterable<Type> types = const [ProfileResponse, _$ProfileResponse];

  @override
  final String wireName = r'ProfileResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfileResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'preferences';
    yield object.preferences == null
        ? null
        : serializers.serialize(object.preferences, specifiedType: const FullType.nullable(ProfilePreferences));
    yield r'profile';
    yield object.profile == null
        ? null
        : serializers.serialize(object.profile, specifiedType: const FullType.nullable(ProfileRow));
    yield r'user';
    yield serializers.serialize(object.user, specifiedType: const FullType(ProfileUser));
  }

  @override
  Object serialize(Serializers serializers, ProfileResponse object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfileResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'preferences':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ProfilePreferences),
          ) as ProfilePreferences?;
          if (valueDes == null) continue;
          result.preferences.replace(valueDes);
          break;
        case r'profile':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(ProfileRow)) as ProfileRow?;
          if (valueDes == null) continue;
          result.profile.replace(valueDes);
          break;
        case r'user':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(ProfileUser)) as ProfileUser;
          result.user.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProfileResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfileResponseBuilder();
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
