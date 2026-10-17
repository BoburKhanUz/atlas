//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'legal_section.g.dart';

/// LegalSection
///
/// Properties:
/// * [heading]
/// * [paragraphs] - Plain text; a paragraph starting with \"• \" is a list item
@BuiltValue()
abstract class LegalSection implements Built<LegalSection, LegalSectionBuilder> {
  @BuiltValueField(wireName: r'heading')
  String get heading;

  /// Plain text; a paragraph starting with \"• \" is a list item
  @BuiltValueField(wireName: r'paragraphs')
  BuiltList<String> get paragraphs;

  LegalSection._();

  factory LegalSection([void updates(LegalSectionBuilder b)]) = _$LegalSection;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LegalSectionBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LegalSection> get serializer => _$LegalSectionSerializer();
}

class _$LegalSectionSerializer implements PrimitiveSerializer<LegalSection> {
  @override
  final Iterable<Type> types = const [LegalSection, _$LegalSection];

  @override
  final String wireName = r'LegalSection';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LegalSection object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'heading';
    yield serializers.serialize(object.heading, specifiedType: const FullType(String));
    yield r'paragraphs';
    yield serializers.serialize(object.paragraphs, specifiedType: const FullType(BuiltList, [FullType(String)]));
  }

  @override
  Object serialize(Serializers serializers, LegalSection object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LegalSectionBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'heading':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.heading = valueDes;
          break;
        case r'paragraphs':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.paragraphs.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LegalSection deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LegalSectionBuilder();
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
