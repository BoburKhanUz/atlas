//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/session_user.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'web_auth_response.g.dart';

/// Web mode: tokens are only in HttpOnly cookies
///
/// Properties:
/// * [user]
@BuiltValue()
abstract class WebAuthResponse implements Built<WebAuthResponse, WebAuthResponseBuilder> {
  @BuiltValueField(wireName: r'user')
  SessionUser get user;

  WebAuthResponse._();

  factory WebAuthResponse([void updates(WebAuthResponseBuilder b)]) = _$WebAuthResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WebAuthResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WebAuthResponse> get serializer => _$WebAuthResponseSerializer();
}

class _$WebAuthResponseSerializer implements PrimitiveSerializer<WebAuthResponse> {
  @override
  final Iterable<Type> types = const [WebAuthResponse, _$WebAuthResponse];

  @override
  final String wireName = r'WebAuthResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WebAuthResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'user';
    yield serializers.serialize(object.user, specifiedType: const FullType(SessionUser));
  }

  @override
  Object serialize(Serializers serializers, WebAuthResponse object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WebAuthResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
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
  WebAuthResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WebAuthResponseBuilder();
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
