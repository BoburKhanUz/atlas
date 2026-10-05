//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/profile_patch_response_user.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_patch_response.g.dart';

/// ProfilePatchResponse
///
/// Properties:
/// * [user]
@BuiltValue()
abstract class ProfilePatchResponse implements Built<ProfilePatchResponse, ProfilePatchResponseBuilder> {
  @BuiltValueField(wireName: r'user')
  ProfilePatchResponseUser get user;

  ProfilePatchResponse._();

  factory ProfilePatchResponse([void updates(ProfilePatchResponseBuilder b)]) = _$ProfilePatchResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfilePatchResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfilePatchResponse> get serializer => _$ProfilePatchResponseSerializer();
}

class _$ProfilePatchResponseSerializer implements PrimitiveSerializer<ProfilePatchResponse> {
  @override
  final Iterable<Type> types = const [ProfilePatchResponse, _$ProfilePatchResponse];

  @override
  final String wireName = r'ProfilePatchResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfilePatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'user';
    yield serializers.serialize(object.user, specifiedType: const FullType(ProfilePatchResponseUser));
  }

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfilePatchResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'user':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ProfilePatchResponseUser),
          ) as ProfilePatchResponseUser;
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
  ProfilePatchResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfilePatchResponseBuilder();
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
