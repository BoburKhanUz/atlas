//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/client_error_report.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'client_errors_request.g.dart';

/// ClientErrorsRequest
///
/// Properties:
/// * [reports]
@BuiltValue()
abstract class ClientErrorsRequest implements Built<ClientErrorsRequest, ClientErrorsRequestBuilder> {
  @BuiltValueField(wireName: r'reports')
  BuiltList<ClientErrorReport> get reports;

  ClientErrorsRequest._();

  factory ClientErrorsRequest([void updates(ClientErrorsRequestBuilder b)]) = _$ClientErrorsRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ClientErrorsRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ClientErrorsRequest> get serializer => _$ClientErrorsRequestSerializer();
}

class _$ClientErrorsRequestSerializer implements PrimitiveSerializer<ClientErrorsRequest> {
  @override
  final Iterable<Type> types = const [ClientErrorsRequest, _$ClientErrorsRequest];

  @override
  final String wireName = r'ClientErrorsRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ClientErrorsRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'reports';
    yield serializers.serialize(
      object.reports,
      specifiedType: const FullType(BuiltList, [FullType(ClientErrorReport)]),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ClientErrorsRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ClientErrorsRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'reports':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ClientErrorReport)]),
          ) as BuiltList<ClientErrorReport>;
          result.reports.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ClientErrorsRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ClientErrorsRequestBuilder();
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
