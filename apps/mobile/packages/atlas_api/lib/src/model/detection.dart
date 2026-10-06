//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'detection.g.dart';

/// Attributes detected from the photo
///
/// Properties:
/// * [category]
/// * [colors]
/// * [confidence]
/// * [fit]
/// * [formality]
/// * [gender]
/// * [material]
/// * [mock] - true when the deterministic development mock produced the attributes; false for a real vision provider
/// * [pattern]
/// * [season]
/// * [sleeveLength]
/// * [style]
/// * [subcategory]
@BuiltValue()
abstract class Detection implements Built<Detection, DetectionBuilder> {
  @BuiltValueField(wireName: r'category')
  String get category;

  @BuiltValueField(wireName: r'colors')
  BuiltList<String> get colors;

  @BuiltValueField(wireName: r'confidence')
  BuiltMap<String, num> get confidence;

  @BuiltValueField(wireName: r'fit')
  String? get fit;

  @BuiltValueField(wireName: r'formality')
  String? get formality;

  @BuiltValueField(wireName: r'gender')
  String? get gender;

  @BuiltValueField(wireName: r'material')
  String? get material;

  /// true when the deterministic development mock produced the attributes; false for a real vision provider
  @BuiltValueField(wireName: r'mock')
  bool get mock;

  @BuiltValueField(wireName: r'pattern')
  String? get pattern;

  @BuiltValueField(wireName: r'season')
  BuiltList<String> get season;

  @BuiltValueField(wireName: r'sleeveLength')
  String? get sleeveLength;

  @BuiltValueField(wireName: r'style')
  String? get style;

  @BuiltValueField(wireName: r'subcategory')
  String? get subcategory;

  Detection._();

  factory Detection([void updates(DetectionBuilder b)]) = _$Detection;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(DetectionBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<Detection> get serializer => _$DetectionSerializer();
}

class _$DetectionSerializer implements PrimitiveSerializer<Detection> {
  @override
  final Iterable<Type> types = const [Detection, _$Detection];

  @override
  final String wireName = r'Detection';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    Detection object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'category';
    yield serializers.serialize(object.category, specifiedType: const FullType(String));
    yield r'colors';
    yield serializers.serialize(object.colors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'confidence';
    yield serializers.serialize(
      object.confidence,
      specifiedType: const FullType(BuiltMap, [FullType(String), FullType(num)]),
    );
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
    yield r'material';
    yield object.material == null
        ? null
        : serializers.serialize(object.material, specifiedType: const FullType.nullable(String));
    yield r'mock';
    yield serializers.serialize(object.mock, specifiedType: const FullType(bool));
    yield r'pattern';
    yield object.pattern == null
        ? null
        : serializers.serialize(object.pattern, specifiedType: const FullType.nullable(String));
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
  }

  @override
  Object serialize(Serializers serializers, Detection object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required DetectionBuilder result,
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
        case r'confidence':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType(num)]),
          ) as BuiltMap<String, num>;
          result.confidence.replace(valueDes);
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
        case r'material':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.material = valueDes;
          break;
        case r'mock':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.mock = valueDes;
          break;
        case r'pattern':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.pattern = valueDes;
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
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  Detection deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = DetectionBuilder();
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
