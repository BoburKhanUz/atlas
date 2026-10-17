//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/legal_section.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'legal_document.g.dart';

/// LegalDocument
///
/// Properties:
/// * [id]
/// * [sections]
/// * [title]
@BuiltValue()
abstract class LegalDocument implements Built<LegalDocument, LegalDocumentBuilder> {
  @BuiltValueField(wireName: r'id')
  LegalDocumentIdEnum get id;
  // enum idEnum {  privacy,  terms,  };

  @BuiltValueField(wireName: r'sections')
  BuiltList<LegalSection> get sections;

  @BuiltValueField(wireName: r'title')
  String get title;

  LegalDocument._();

  factory LegalDocument([void updates(LegalDocumentBuilder b)]) = _$LegalDocument;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LegalDocumentBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LegalDocument> get serializer => _$LegalDocumentSerializer();
}

class _$LegalDocumentSerializer implements PrimitiveSerializer<LegalDocument> {
  @override
  final Iterable<Type> types = const [LegalDocument, _$LegalDocument];

  @override
  final String wireName = r'LegalDocument';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LegalDocument object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(LegalDocumentIdEnum));
    yield r'sections';
    yield serializers.serialize(object.sections, specifiedType: const FullType(BuiltList, [FullType(LegalSection)]));
    yield r'title';
    yield serializers.serialize(object.title, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, LegalDocument object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LegalDocumentBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType(LegalDocumentIdEnum)) as LegalDocumentIdEnum;
          result.id = valueDes;
          break;
        case r'sections':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(LegalSection)]),
          ) as BuiltList<LegalSection>;
          result.sections.replace(valueDes);
          break;
        case r'title':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.title = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LegalDocument deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LegalDocumentBuilder();
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

class LegalDocumentIdEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'privacy')
  static const LegalDocumentIdEnum privacy = _$legalDocumentIdEnum_privacy;
  @BuiltValueEnumConst(wireName: r'terms')
  static const LegalDocumentIdEnum terms = _$legalDocumentIdEnum_terms;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const LegalDocumentIdEnum unknownDefaultOpenApi = _$legalDocumentIdEnum_unknownDefaultOpenApi;

  static Serializer<LegalDocumentIdEnum> get serializer => _$legalDocumentIdEnumSerializer;

  const LegalDocumentIdEnum._(String name) : super(name);

  static BuiltSet<LegalDocumentIdEnum> get values => _$legalDocumentIdEnumValues;
  static LegalDocumentIdEnum valueOf(String name) => _$legalDocumentIdEnumValueOf(name);
}
