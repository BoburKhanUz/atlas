//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/profile_patch_request_preferences.dart';
import 'package:atlas_api/src/model/profile_patch_request_profile.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_patch_request.g.dart';

/// ProfilePatchRequest
///
/// Properties:
/// * [name]
/// * [preferences]
/// * [profile]
@BuiltValue()
abstract class ProfilePatchRequest implements Built<ProfilePatchRequest, ProfilePatchRequestBuilder> {
  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'preferences')
  ProfilePatchRequestPreferences? get preferences;

  @BuiltValueField(wireName: r'profile')
  ProfilePatchRequestProfile? get profile;

  ProfilePatchRequest._();

  factory ProfilePatchRequest([void updates(ProfilePatchRequestBuilder b)]) = _$ProfilePatchRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfilePatchRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfilePatchRequest> get serializer => _$ProfilePatchRequestSerializer();
}

class _$ProfilePatchRequestSerializer implements PrimitiveSerializer<ProfilePatchRequest> {
  @override
  final Iterable<Type> types = const [ProfilePatchRequest, _$ProfilePatchRequest];

  @override
  final String wireName = r'ProfilePatchRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfilePatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.name != null) {
      yield r'name';
      yield serializers.serialize(object.name, specifiedType: const FullType(String));
    }
    if (object.preferences != null) {
      yield r'preferences';
      yield serializers.serialize(object.preferences, specifiedType: const FullType(ProfilePatchRequestPreferences));
    }
    if (object.profile != null) {
      yield r'profile';
      yield serializers.serialize(object.profile, specifiedType: const FullType(ProfilePatchRequestProfile));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfilePatchRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.name = valueDes;
          break;
        case r'preferences':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ProfilePatchRequestPreferences),
          ) as ProfilePatchRequestPreferences;
          result.preferences.replace(valueDes);
          break;
        case r'profile':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ProfilePatchRequestProfile),
          ) as ProfilePatchRequestProfile;
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
  ProfilePatchRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfilePatchRequestBuilder();
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
