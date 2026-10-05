//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/session_user.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'mobile_auth_response.g.dart';

/// Mobile mode (X-Atlas-Client: mobile): tokens in the body, no cookies
///
/// Properties:
/// * [accessToken]
/// * [accessTokenExpiresAt] - ISO 8601, UTC
/// * [refreshToken]
/// * [refreshTokenExpiresAt] - ISO 8601, UTC
/// * [sessionExpiresAt] - Absolute limit of this login (90 days); refresh is impossible afterwards
/// * [user]
@BuiltValue()
abstract class MobileAuthResponse implements Built<MobileAuthResponse, MobileAuthResponseBuilder> {
  @BuiltValueField(wireName: r'accessToken')
  String get accessToken;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'accessTokenExpiresAt')
  DateTime get accessTokenExpiresAt;

  @BuiltValueField(wireName: r'refreshToken')
  String get refreshToken;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'refreshTokenExpiresAt')
  DateTime get refreshTokenExpiresAt;

  /// Absolute limit of this login (90 days); refresh is impossible afterwards
  @BuiltValueField(wireName: r'sessionExpiresAt')
  DateTime get sessionExpiresAt;

  @BuiltValueField(wireName: r'user')
  SessionUser get user;

  MobileAuthResponse._();

  factory MobileAuthResponse([void updates(MobileAuthResponseBuilder b)]) = _$MobileAuthResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(MobileAuthResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<MobileAuthResponse> get serializer => _$MobileAuthResponseSerializer();
}

class _$MobileAuthResponseSerializer implements PrimitiveSerializer<MobileAuthResponse> {
  @override
  final Iterable<Type> types = const [MobileAuthResponse, _$MobileAuthResponse];

  @override
  final String wireName = r'MobileAuthResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    MobileAuthResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'accessToken';
    yield serializers.serialize(object.accessToken, specifiedType: const FullType(String));
    yield r'accessTokenExpiresAt';
    yield serializers.serialize(object.accessTokenExpiresAt, specifiedType: const FullType(DateTime));
    yield r'refreshToken';
    yield serializers.serialize(object.refreshToken, specifiedType: const FullType(String));
    yield r'refreshTokenExpiresAt';
    yield serializers.serialize(object.refreshTokenExpiresAt, specifiedType: const FullType(DateTime));
    yield r'sessionExpiresAt';
    yield serializers.serialize(object.sessionExpiresAt, specifiedType: const FullType(DateTime));
    yield r'user';
    yield serializers.serialize(object.user, specifiedType: const FullType(SessionUser));
  }

  @override
  Object serialize(
    Serializers serializers,
    MobileAuthResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required MobileAuthResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'accessToken':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.accessToken = valueDes;
          break;
        case r'accessTokenExpiresAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.accessTokenExpiresAt = valueDes;
          break;
        case r'refreshToken':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.refreshToken = valueDes;
          break;
        case r'refreshTokenExpiresAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.refreshTokenExpiresAt = valueDes;
          break;
        case r'sessionExpiresAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.sessionExpiresAt = valueDes;
          break;
        case r'user':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(SessionUser)) as SessionUser;
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
  MobileAuthResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = MobileAuthResponseBuilder();
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
