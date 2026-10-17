//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'register_request.g.dart';

/// RegisterRequest
///
/// Properties:
/// * [acceptedLegalVersion] - The `version` from GET /api/v1/legal that the user accepted; it must be the current one.
/// * [ageConfirmed] - The user confirmed being 18 or older; must be true.
/// * [deviceName] - Mobile only: a label for the device in the session list (ignored for web).
/// * [email]
/// * [name]
/// * [password]
@BuiltValue()
abstract class RegisterRequest implements Built<RegisterRequest, RegisterRequestBuilder> {
  /// The `version` from GET /api/v1/legal that the user accepted; it must be the current one.
  @BuiltValueField(wireName: r'acceptedLegalVersion')
  String get acceptedLegalVersion;

  /// The user confirmed being 18 or older; must be true.
  @BuiltValueField(wireName: r'ageConfirmed')
  bool get ageConfirmed;

  /// Mobile only: a label for the device in the session list (ignored for web).
  @BuiltValueField(wireName: r'deviceName')
  String? get deviceName;

  @BuiltValueField(wireName: r'email')
  String get email;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'password')
  String get password;

  RegisterRequest._();

  factory RegisterRequest([void updates(RegisterRequestBuilder b)]) = _$RegisterRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(RegisterRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<RegisterRequest> get serializer => _$RegisterRequestSerializer();
}

class _$RegisterRequestSerializer implements PrimitiveSerializer<RegisterRequest> {
  @override
  final Iterable<Type> types = const [RegisterRequest, _$RegisterRequest];

  @override
  final String wireName = r'RegisterRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    RegisterRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'acceptedLegalVersion';
    yield serializers.serialize(object.acceptedLegalVersion, specifiedType: const FullType(String));
    yield r'ageConfirmed';
    yield serializers.serialize(object.ageConfirmed, specifiedType: const FullType(bool));
    if (object.deviceName != null) {
      yield r'deviceName';
      yield serializers.serialize(object.deviceName, specifiedType: const FullType(String));
    }
    yield r'email';
    yield serializers.serialize(object.email, specifiedType: const FullType(String));
    if (object.name != null) {
      yield r'name';
      yield serializers.serialize(object.name, specifiedType: const FullType(String));
    }
    yield r'password';
    yield serializers.serialize(object.password, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, RegisterRequest object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required RegisterRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'acceptedLegalVersion':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.acceptedLegalVersion = valueDes;
          break;
        case r'ageConfirmed':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.ageConfirmed = valueDes;
          break;
        case r'deviceName':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.deviceName = valueDes;
          break;
        case r'email':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.email = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.name = valueDes;
          break;
        case r'password':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.password = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  RegisterRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = RegisterRequestBuilder();
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
