//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/detection.dart';
import 'package:atlas_api/src/model/wardrobe_item.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_upload_response.g.dart';

/// WardrobeUploadResponse
///
/// Properties:
/// * [detection]
/// * [item]
@BuiltValue()
abstract class WardrobeUploadResponse implements Built<WardrobeUploadResponse, WardrobeUploadResponseBuilder> {
  @BuiltValueField(wireName: r'detection')
  Detection get detection;

  @BuiltValueField(wireName: r'item')
  WardrobeItem get item;

  WardrobeUploadResponse._();

  factory WardrobeUploadResponse([void updates(WardrobeUploadResponseBuilder b)]) = _$WardrobeUploadResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeUploadResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeUploadResponse> get serializer => _$WardrobeUploadResponseSerializer();
}

class _$WardrobeUploadResponseSerializer implements PrimitiveSerializer<WardrobeUploadResponse> {
  @override
  final Iterable<Type> types = const [WardrobeUploadResponse, _$WardrobeUploadResponse];

  @override
  final String wireName = r'WardrobeUploadResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeUploadResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'detection';
    yield serializers.serialize(object.detection, specifiedType: const FullType(Detection));
    yield r'item';
    yield serializers.serialize(object.item, specifiedType: const FullType(WardrobeItem));
  }

  @override
  Object serialize(
    Serializers serializers,
    WardrobeUploadResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeUploadResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'detection':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(Detection)) as Detection;
          result.detection.replace(valueDes);
          break;
        case r'item':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(WardrobeItem)) as WardrobeItem;
          result.item.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeUploadResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeUploadResponseBuilder();
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
