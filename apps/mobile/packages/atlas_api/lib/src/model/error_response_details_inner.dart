//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'error_response_details_inner.g.dart';

/// ErrorResponseDetailsInner
///
/// Properties:
/// * [message]
/// * [path]
@BuiltValue()
abstract class ErrorResponseDetailsInner implements Built<ErrorResponseDetailsInner, ErrorResponseDetailsInnerBuilder> {
  @BuiltValueField(wireName: r'message')
  String get message;

  @BuiltValueField(wireName: r'path')
  String get path;

  ErrorResponseDetailsInner._();

  factory ErrorResponseDetailsInner([void updates(ErrorResponseDetailsInnerBuilder b)]) = _$ErrorResponseDetailsInner;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ErrorResponseDetailsInnerBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ErrorResponseDetailsInner> get serializer => _$ErrorResponseDetailsInnerSerializer();
}

class _$ErrorResponseDetailsInnerSerializer implements PrimitiveSerializer<ErrorResponseDetailsInner> {
  @override
  final Iterable<Type> types = const [ErrorResponseDetailsInner, _$ErrorResponseDetailsInner];

  @override
  final String wireName = r'ErrorResponseDetailsInner';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ErrorResponseDetailsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'message';
    yield serializers.serialize(object.message, specifiedType: const FullType(String));
    yield r'path';
    yield serializers.serialize(object.path, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    ErrorResponseDetailsInner object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ErrorResponseDetailsInnerBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'message':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.message = valueDes;
          break;
        case r'path':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.path = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ErrorResponseDetailsInner deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ErrorResponseDetailsInnerBuilder();
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
