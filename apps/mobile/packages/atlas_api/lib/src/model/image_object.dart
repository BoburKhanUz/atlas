//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'image_object.g.dart';

/// A stored garment image. The full-resolution master is never exposed.
///
/// Properties:
/// * [height]
/// * [id]
/// * [isPrimary]
/// * [thumbnailUrl]
/// * [url] - Signed URL of the 1600 px display image (absolute when PUBLIC_BASE_URL is set)
/// * [urlExpiresAt] - When url and thumbnailUrl stop working; cache images by id + variant
/// * [width]
@BuiltValue()
abstract class ImageObject implements Built<ImageObject, ImageObjectBuilder> {
  @BuiltValueField(wireName: r'height')
  int? get height;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'isPrimary')
  bool get isPrimary;

  @BuiltValueField(wireName: r'thumbnailUrl')
  String? get thumbnailUrl;

  /// Signed URL of the 1600 px display image (absolute when PUBLIC_BASE_URL is set)
  @BuiltValueField(wireName: r'url')
  String get url;

  /// When url and thumbnailUrl stop working; cache images by id + variant
  @BuiltValueField(wireName: r'urlExpiresAt')
  DateTime get urlExpiresAt;

  @BuiltValueField(wireName: r'width')
  int? get width;

  ImageObject._();

  factory ImageObject([void updates(ImageObjectBuilder b)]) = _$ImageObject;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ImageObjectBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ImageObject> get serializer => _$ImageObjectSerializer();
}

class _$ImageObjectSerializer implements PrimitiveSerializer<ImageObject> {
  @override
  final Iterable<Type> types = const [ImageObject, _$ImageObject];

  @override
  final String wireName = r'ImageObject';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ImageObject object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'height';
    yield object.height == null
        ? null
        : serializers.serialize(object.height, specifiedType: const FullType.nullable(int));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'isPrimary';
    yield serializers.serialize(object.isPrimary, specifiedType: const FullType(bool));
    yield r'thumbnailUrl';
    yield object.thumbnailUrl == null
        ? null
        : serializers.serialize(object.thumbnailUrl, specifiedType: const FullType.nullable(String));
    yield r'url';
    yield serializers.serialize(object.url, specifiedType: const FullType(String));
    yield r'urlExpiresAt';
    yield serializers.serialize(object.urlExpiresAt, specifiedType: const FullType(DateTime));
    yield r'width';
    yield object.width == null
        ? null
        : serializers.serialize(object.width, specifiedType: const FullType.nullable(int));
  }

  @override
  Object serialize(Serializers serializers, ImageObject object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ImageObjectBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'height':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(int)) as int?;
          if (valueDes == null) continue;
          result.height = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'isPrimary':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.isPrimary = valueDes;
          break;
        case r'thumbnailUrl':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.thumbnailUrl = valueDes;
          break;
        case r'url':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.url = valueDes;
          break;
        case r'urlExpiresAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.urlExpiresAt = valueDes;
          break;
        case r'width':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(int)) as int?;
          if (valueDes == null) continue;
          result.width = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ImageObject deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = ImageObjectBuilder();
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
