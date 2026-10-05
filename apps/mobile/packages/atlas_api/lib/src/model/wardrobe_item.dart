//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/correction_log_entry.dart';
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/image_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_item.g.dart';

/// WardrobeItem
///
/// Properties:
/// * [category]
/// * [colors]
/// * [confidences]
/// * [correctionLog]
/// * [createdAt] - ISO 8601, UTC
/// * [fit]
/// * [formality]
/// * [gender]
/// * [id]
/// * [images]
/// * [material]
/// * [pattern]
/// * [primaryImage]
/// * [season]
/// * [sleeveLength]
/// * [style]
/// * [subcategory]
/// * [updatedAt] - ISO 8601, UTC
/// * [wasCorrected]
@BuiltValue()
abstract class WardrobeItem implements Built<WardrobeItem, WardrobeItemBuilder> {
  @BuiltValueField(wireName: r'category')
  String get category;

  @BuiltValueField(wireName: r'colors')
  BuiltList<String> get colors;

  @BuiltValueField(wireName: r'confidences')
  BuiltMap<String, num> get confidences;

  @BuiltValueField(wireName: r'correctionLog')
  BuiltList<CorrectionLogEntry> get correctionLog;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'fit')
  String? get fit;

  @BuiltValueField(wireName: r'formality')
  String? get formality;

  @BuiltValueField(wireName: r'gender')
  String? get gender;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'images')
  BuiltList<ImageObject> get images;

  @BuiltValueField(wireName: r'material')
  String? get material;

  @BuiltValueField(wireName: r'pattern')
  String? get pattern;

  @BuiltValueField(wireName: r'primaryImage')
  ImageObject? get primaryImage;

  @BuiltValueField(wireName: r'season')
  BuiltList<String> get season;

  @BuiltValueField(wireName: r'sleeveLength')
  String? get sleeveLength;

  @BuiltValueField(wireName: r'style')
  String? get style;

  @BuiltValueField(wireName: r'subcategory')
  String? get subcategory;

  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'updatedAt')
  DateTime get updatedAt;

  @BuiltValueField(wireName: r'wasCorrected')
  bool get wasCorrected;

  WardrobeItem._();

  factory WardrobeItem([void updates(WardrobeItemBuilder b)]) = _$WardrobeItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeItem> get serializer => _$WardrobeItemSerializer();
}

class _$WardrobeItemSerializer implements PrimitiveSerializer<WardrobeItem> {
  @override
  final Iterable<Type> types = const [WardrobeItem, _$WardrobeItem];

  @override
  final String wireName = r'WardrobeItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'category';
    yield serializers.serialize(object.category, specifiedType: const FullType(String));
    yield r'colors';
    yield serializers.serialize(object.colors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'confidences';
    yield serializers.serialize(
      object.confidences,
      specifiedType: const FullType(BuiltMap, [FullType(String), FullType(num)]),
    );
    yield r'correctionLog';
    yield serializers.serialize(
      object.correctionLog,
      specifiedType: const FullType(BuiltList, [FullType(CorrectionLogEntry)]),
    );
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'fit';
    yield object.fit == null ? null : serializers.serialize(object.fit, specifiedType: const FullType.nullable(String));
    yield r'formality';
    yield object.formality == null
        ? null
        : serializers.serialize(object.formality, specifiedType: const FullType.nullable(String));
    yield r'gender';
    yield object.gender == null
        ? null
        : serializers.serialize(object.gender, specifiedType: const FullType.nullable(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'images';
    yield serializers.serialize(object.images, specifiedType: const FullType(BuiltList, [FullType(ImageObject)]));
    yield r'material';
    yield object.material == null
        ? null
        : serializers.serialize(object.material, specifiedType: const FullType.nullable(String));
    yield r'pattern';
    yield object.pattern == null
        ? null
        : serializers.serialize(object.pattern, specifiedType: const FullType.nullable(String));
    yield r'primaryImage';
    yield object.primaryImage == null
        ? null
        : serializers.serialize(object.primaryImage, specifiedType: const FullType.nullable(ImageObject));
    yield r'season';
    yield serializers.serialize(object.season, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'sleeveLength';
    yield object.sleeveLength == null
        ? null
        : serializers.serialize(object.sleeveLength, specifiedType: const FullType.nullable(String));
    yield r'style';
    yield object.style == null
        ? null
        : serializers.serialize(object.style, specifiedType: const FullType.nullable(String));
    yield r'subcategory';
    yield object.subcategory == null
        ? null
        : serializers.serialize(object.subcategory, specifiedType: const FullType.nullable(String));
    yield r'updatedAt';
    yield serializers.serialize(object.updatedAt, specifiedType: const FullType(DateTime));
    yield r'wasCorrected';
    yield serializers.serialize(object.wasCorrected, specifiedType: const FullType(bool));
  }

  @override
  Object serialize(Serializers serializers, WardrobeItem object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeItemBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'category':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.category = valueDes;
          break;
        case r'colors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.colors.replace(valueDes);
          break;
        case r'confidences':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType(num)]),
          ) as BuiltMap<String, num>;
          result.confidences.replace(valueDes);
          break;
        case r'correctionLog':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(CorrectionLogEntry)]),
          ) as BuiltList<CorrectionLogEntry>;
          result.correctionLog.replace(valueDes);
          break;
        case r'createdAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.createdAt = valueDes;
          break;
        case r'fit':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.fit = valueDes;
          break;
        case r'formality':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.formality = valueDes;
          break;
        case r'gender':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.gender = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'images':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ImageObject)]),
          ) as BuiltList<ImageObject>;
          result.images.replace(valueDes);
          break;
        case r'material':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.material = valueDes;
          break;
        case r'pattern':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.pattern = valueDes;
          break;
        case r'primaryImage':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType.nullable(ImageObject)) as ImageObject?;
          if (valueDes == null) continue;
          result.primaryImage.replace(valueDes);
          break;
        case r'season':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.season.replace(valueDes);
          break;
        case r'sleeveLength':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.sleeveLength = valueDes;
          break;
        case r'style':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.style = valueDes;
          break;
        case r'subcategory':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.subcategory = valueDes;
          break;
        case r'updatedAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.updatedAt = valueDes;
          break;
        case r'wasCorrected':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.wasCorrected = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeItemBuilder();
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
