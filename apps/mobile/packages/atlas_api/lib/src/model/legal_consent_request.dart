//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'legal_consent_request.g.dart';

/// LegalConsentRequest
///
/// Properties:
/// * [acceptedLegalVersion] - The `version` from GET /api/v1/legal that the user accepted; it must be the current one.
/// * [ageConfirmed] - The user confirmed being 18 or older; must be true.
@BuiltValue()
abstract class LegalConsentRequest implements Built<LegalConsentRequest, LegalConsentRequestBuilder> {
  /// The `version` from GET /api/v1/legal that the user accepted; it must be the current one.
  @BuiltValueField(wireName: r'acceptedLegalVersion')
  String get acceptedLegalVersion;

  /// The user confirmed being 18 or older; must be true.
  @BuiltValueField(wireName: r'ageConfirmed')
  bool get ageConfirmed;

  LegalConsentRequest._();

  factory LegalConsentRequest([void updates(LegalConsentRequestBuilder b)]) = _$LegalConsentRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LegalConsentRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LegalConsentRequest> get serializer => _$LegalConsentRequestSerializer();
}

class _$LegalConsentRequestSerializer implements PrimitiveSerializer<LegalConsentRequest> {
  @override
  final Iterable<Type> types = const [LegalConsentRequest, _$LegalConsentRequest];

  @override
  final String wireName = r'LegalConsentRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LegalConsentRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'acceptedLegalVersion';
    yield serializers.serialize(object.acceptedLegalVersion, specifiedType: const FullType(String));
    yield r'ageConfirmed';
    yield serializers.serialize(object.ageConfirmed, specifiedType: const FullType(bool));
  }

  @override
  Object serialize(
    Serializers serializers,
    LegalConsentRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LegalConsentRequestBuilder result,
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
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LegalConsentRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LegalConsentRequestBuilder();
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
