//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'mobile_logout_request.g.dart';

/// MobileLogoutRequest
///
/// Properties:
/// * [refreshToken]
@BuiltValue()
abstract class MobileLogoutRequest implements Built<MobileLogoutRequest, MobileLogoutRequestBuilder> {
  @BuiltValueField(wireName: r'refreshToken')
  String? get refreshToken;

  MobileLogoutRequest._();

  factory MobileLogoutRequest([void updates(MobileLogoutRequestBuilder b)]) = _$MobileLogoutRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(MobileLogoutRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<MobileLogoutRequest> get serializer => _$MobileLogoutRequestSerializer();
}

class _$MobileLogoutRequestSerializer implements PrimitiveSerializer<MobileLogoutRequest> {
  @override
  final Iterable<Type> types = const [MobileLogoutRequest, _$MobileLogoutRequest];

  @override
  final String wireName = r'MobileLogoutRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    MobileLogoutRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.refreshToken != null) {
      yield r'refreshToken';
      yield serializers.serialize(object.refreshToken, specifiedType: const FullType(String));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    MobileLogoutRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required MobileLogoutRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'refreshToken':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.refreshToken = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  MobileLogoutRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = MobileLogoutRequestBuilder();
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
