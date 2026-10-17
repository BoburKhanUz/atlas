//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'password_forgot_request.g.dart';

/// PasswordForgotRequest
///
/// Properties:
/// * [email]
@BuiltValue()
abstract class PasswordForgotRequest implements Built<PasswordForgotRequest, PasswordForgotRequestBuilder> {
  @BuiltValueField(wireName: r'email')
  String get email;

  PasswordForgotRequest._();

  factory PasswordForgotRequest([void updates(PasswordForgotRequestBuilder b)]) = _$PasswordForgotRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PasswordForgotRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PasswordForgotRequest> get serializer => _$PasswordForgotRequestSerializer();
}

class _$PasswordForgotRequestSerializer implements PrimitiveSerializer<PasswordForgotRequest> {
  @override
  final Iterable<Type> types = const [PasswordForgotRequest, _$PasswordForgotRequest];

  @override
  final String wireName = r'PasswordForgotRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PasswordForgotRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'email';
    yield serializers.serialize(object.email, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    PasswordForgotRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PasswordForgotRequestBuilder result,
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
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PasswordForgotRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PasswordForgotRequestBuilder();
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
