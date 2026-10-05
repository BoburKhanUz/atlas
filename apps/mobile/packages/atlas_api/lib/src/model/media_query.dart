//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'media_query.g.dart';

/// MediaQuery
///
/// Properties:
/// * [exp] - Expiry (unix seconds), part of the signed URL
/// * [sig] - HMAC signature, part of the signed URL
@BuiltValue()
abstract class MediaQuery implements Built<MediaQuery, MediaQueryBuilder> {
  /// Expiry (unix seconds), part of the signed URL
  @BuiltValueField(wireName: r'exp')
  String get exp;

  /// HMAC signature, part of the signed URL
  @BuiltValueField(wireName: r'sig')
  String get sig;

  MediaQuery._();

  factory MediaQuery([void updates(MediaQueryBuilder b)]) = _$MediaQuery;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(MediaQueryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<MediaQuery> get serializer => _$MediaQuerySerializer();
}

class _$MediaQuerySerializer implements PrimitiveSerializer<MediaQuery> {
  @override
  final Iterable<Type> types = const [MediaQuery, _$MediaQuery];

  @override
  final String wireName = r'MediaQuery';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    MediaQuery object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'exp';
    yield serializers.serialize(object.exp, specifiedType: const FullType(String));
    yield r'sig';
    yield serializers.serialize(object.sig, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, MediaQuery object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required MediaQueryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'exp':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.exp = valueDes;
          break;
        case r'sig':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.sig = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  MediaQuery deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = MediaQueryBuilder();
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
