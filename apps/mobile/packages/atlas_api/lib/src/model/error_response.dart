//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/error_response_details_inner.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'error_response.g.dart';

/// Every error response. Clients branch on `code`, never on `error`.
///
/// Properties:
/// * [code]
/// * [details]
/// * [error] - User-facing message (Uzbek)
/// * [requestId]
@BuiltValue()
abstract class ErrorResponse implements Built<ErrorResponse, ErrorResponseBuilder> {
  @BuiltValueField(wireName: r'code')
  ErrorResponseCodeEnum get code;
  // enum codeEnum {  BAD_REQUEST,  VALIDATION_ERROR,  UNAUTHORIZED,  FORBIDDEN,  NOT_FOUND,  CONFLICT,  PAYLOAD_TOO_LARGE,  UNSUPPORTED_MEDIA_TYPE,  INVALID_IMAGE,  UNSUPPORTED_IMAGE_FORMAT,  IMAGE_DIMENSIONS,  IDEMPOTENCY_KEY_MISMATCH,  IDEMPOTENCY_IN_PROGRESS,  RATE_LIMITED,  INTERNAL,  INVALID_TOKEN,  SESSION_EXPIRED,  SESSION_REVOKED,  REFRESH_REUSED,  SESSION_RACE,  CLIENT_MISMATCH,  SESSION_BUSY,  };

  @BuiltValueField(wireName: r'details')
  BuiltList<ErrorResponseDetailsInner>? get details;

  /// User-facing message (Uzbek)
  @BuiltValueField(wireName: r'error')
  String get error;

  @BuiltValueField(wireName: r'requestId')
  String? get requestId;

  ErrorResponse._();

  factory ErrorResponse([void updates(ErrorResponseBuilder b)]) = _$ErrorResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ErrorResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ErrorResponse> get serializer => _$ErrorResponseSerializer();
}

class _$ErrorResponseSerializer implements PrimitiveSerializer<ErrorResponse> {
  @override
  final Iterable<Type> types = const [ErrorResponse, _$ErrorResponse];

  @override
  final String wireName = r'ErrorResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ErrorResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'code';
    yield serializers.serialize(object.code, specifiedType: const FullType(ErrorResponseCodeEnum));
    if (object.details != null) {
      yield r'details';
      yield serializers.serialize(
        object.details,
        specifiedType: const FullType(BuiltList, [FullType(ErrorResponseDetailsInner)]),
      );
    }
    yield r'error';
    yield serializers.serialize(object.error, specifiedType: const FullType(String));
    if (object.requestId != null) {
      yield r'requestId';
      yield serializers.serialize(object.requestId, specifiedType: const FullType(String));
    }
  }

  @override
  Object serialize(Serializers serializers, ErrorResponse object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ErrorResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'code':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ErrorResponseCodeEnum),
          ) as ErrorResponseCodeEnum;
          result.code = valueDes;
          break;
        case r'details':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ErrorResponseDetailsInner)]),
          ) as BuiltList<ErrorResponseDetailsInner>;
          result.details.replace(valueDes);
          break;
        case r'error':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.error = valueDes;
          break;
        case r'requestId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.requestId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ErrorResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ErrorResponseBuilder();
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

class ErrorResponseCodeEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'BAD_REQUEST')
  static const ErrorResponseCodeEnum BAD_REQUEST = _$errorResponseCodeEnum_BAD_REQUEST;
  @BuiltValueEnumConst(wireName: r'VALIDATION_ERROR')
  static const ErrorResponseCodeEnum VALIDATION_ERROR = _$errorResponseCodeEnum_VALIDATION_ERROR;
  @BuiltValueEnumConst(wireName: r'UNAUTHORIZED')
  static const ErrorResponseCodeEnum UNAUTHORIZED = _$errorResponseCodeEnum_UNAUTHORIZED;
  @BuiltValueEnumConst(wireName: r'FORBIDDEN')
  static const ErrorResponseCodeEnum FORBIDDEN = _$errorResponseCodeEnum_FORBIDDEN;
  @BuiltValueEnumConst(wireName: r'NOT_FOUND')
  static const ErrorResponseCodeEnum NOT_FOUND = _$errorResponseCodeEnum_NOT_FOUND;
  @BuiltValueEnumConst(wireName: r'CONFLICT')
  static const ErrorResponseCodeEnum CONFLICT = _$errorResponseCodeEnum_CONFLICT;
  @BuiltValueEnumConst(wireName: r'PAYLOAD_TOO_LARGE')
  static const ErrorResponseCodeEnum PAYLOAD_TOO_LARGE = _$errorResponseCodeEnum_PAYLOAD_TOO_LARGE;
  @BuiltValueEnumConst(wireName: r'UNSUPPORTED_MEDIA_TYPE')
  static const ErrorResponseCodeEnum UNSUPPORTED_MEDIA_TYPE = _$errorResponseCodeEnum_UNSUPPORTED_MEDIA_TYPE;
  @BuiltValueEnumConst(wireName: r'INVALID_IMAGE')
  static const ErrorResponseCodeEnum INVALID_IMAGE = _$errorResponseCodeEnum_INVALID_IMAGE;
  @BuiltValueEnumConst(wireName: r'UNSUPPORTED_IMAGE_FORMAT')
  static const ErrorResponseCodeEnum UNSUPPORTED_IMAGE_FORMAT = _$errorResponseCodeEnum_UNSUPPORTED_IMAGE_FORMAT;
  @BuiltValueEnumConst(wireName: r'IMAGE_DIMENSIONS')
  static const ErrorResponseCodeEnum IMAGE_DIMENSIONS = _$errorResponseCodeEnum_IMAGE_DIMENSIONS;
  @BuiltValueEnumConst(wireName: r'IDEMPOTENCY_KEY_MISMATCH')
  static const ErrorResponseCodeEnum IDEMPOTENCY_KEY_MISMATCH = _$errorResponseCodeEnum_IDEMPOTENCY_KEY_MISMATCH;
  @BuiltValueEnumConst(wireName: r'IDEMPOTENCY_IN_PROGRESS')
  static const ErrorResponseCodeEnum IDEMPOTENCY_IN_PROGRESS = _$errorResponseCodeEnum_IDEMPOTENCY_IN_PROGRESS;
  @BuiltValueEnumConst(wireName: r'RATE_LIMITED')
  static const ErrorResponseCodeEnum RATE_LIMITED = _$errorResponseCodeEnum_RATE_LIMITED;
  @BuiltValueEnumConst(wireName: r'INTERNAL')
  static const ErrorResponseCodeEnum INTERNAL = _$errorResponseCodeEnum_INTERNAL;
  @BuiltValueEnumConst(wireName: r'INVALID_TOKEN')
  static const ErrorResponseCodeEnum INVALID_TOKEN = _$errorResponseCodeEnum_INVALID_TOKEN;
  @BuiltValueEnumConst(wireName: r'SESSION_EXPIRED')
  static const ErrorResponseCodeEnum SESSION_EXPIRED = _$errorResponseCodeEnum_SESSION_EXPIRED;
  @BuiltValueEnumConst(wireName: r'SESSION_REVOKED')
  static const ErrorResponseCodeEnum SESSION_REVOKED = _$errorResponseCodeEnum_SESSION_REVOKED;
  @BuiltValueEnumConst(wireName: r'REFRESH_REUSED')
  static const ErrorResponseCodeEnum REFRESH_REUSED = _$errorResponseCodeEnum_REFRESH_REUSED;
  @BuiltValueEnumConst(wireName: r'SESSION_RACE')
  static const ErrorResponseCodeEnum SESSION_RACE = _$errorResponseCodeEnum_SESSION_RACE;
  @BuiltValueEnumConst(wireName: r'CLIENT_MISMATCH')
  static const ErrorResponseCodeEnum CLIENT_MISMATCH = _$errorResponseCodeEnum_CLIENT_MISMATCH;
  @BuiltValueEnumConst(wireName: r'SESSION_BUSY')
  static const ErrorResponseCodeEnum SESSION_BUSY = _$errorResponseCodeEnum_SESSION_BUSY;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ErrorResponseCodeEnum unknownDefaultOpenApi = _$errorResponseCodeEnum_unknownDefaultOpenApi;

  static Serializer<ErrorResponseCodeEnum> get serializer => _$errorResponseCodeEnumSerializer;

  const ErrorResponseCodeEnum._(String name) : super(name);

  static BuiltSet<ErrorResponseCodeEnum> get values => _$errorResponseCodeEnumValues;
  static ErrorResponseCodeEnum valueOf(String name) => _$errorResponseCodeEnumValueOf(name);
}
