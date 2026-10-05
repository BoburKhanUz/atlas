//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/web_auth_response.dart';
import 'package:atlas_api/src/model/mobile_auth_response.dart';
import 'package:atlas_api/src/model/session_user.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'auth_response.g.dart';

/// AuthResponse
///
/// Properties:
/// * [accessToken]
/// * [accessTokenExpiresAt] - ISO 8601, UTC
/// * [refreshToken]
/// * [refreshTokenExpiresAt] - ISO 8601, UTC
/// * [sessionExpiresAt] - Absolute limit of this login (90 days); refresh is impossible afterwards
/// * [user]
@BuiltValue()
abstract class AuthResponse implements Built<AuthResponse, AuthResponseBuilder> {
  /// Any Of [MobileAuthResponse], [WebAuthResponse]
  AnyOf get anyOf;

  AuthResponse._();

  factory AuthResponse([void updates(AuthResponseBuilder b)]) = _$AuthResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(AuthResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<AuthResponse> get serializer => _$AuthResponseSerializer();
}

class _$AuthResponseSerializer implements PrimitiveSerializer<AuthResponse> {
  @override
  final Iterable<Type> types = const [AuthResponse, _$AuthResponse];

  @override
  final String wireName = r'AuthResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    AuthResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {}

  @override
  Object serialize(Serializers serializers, AuthResponse object, {FullType specifiedType = FullType.unspecified}) {
    final anyOf = object.anyOf;
    return serializers.serialize(
      anyOf,
      specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()),
    )!;
  }

  @override
  AuthResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = AuthResponseBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [FullType(MobileAuthResponse), FullType(WebAuthResponse)]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}
