//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/legal_document.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'legal_response.g.dart';

/// LegalResponse
///
/// Properties:
/// * [documents]
/// * [draft] - True while the texts await legal review: clients show a draft notice
/// * [effectiveDate] - YYYY-MM-DD
/// * [version] - Send it back as acceptedLegalVersion when registering
@BuiltValue()
abstract class LegalResponse implements Built<LegalResponse, LegalResponseBuilder> {
  @BuiltValueField(wireName: r'documents')
  BuiltList<LegalDocument> get documents;

  /// True while the texts await legal review: clients show a draft notice
  @BuiltValueField(wireName: r'draft')
  bool get draft;

  /// YYYY-MM-DD
  @BuiltValueField(wireName: r'effectiveDate')
  String get effectiveDate;

  /// Send it back as acceptedLegalVersion when registering
  @BuiltValueField(wireName: r'version')
  String get version;

  LegalResponse._();

  factory LegalResponse([void updates(LegalResponseBuilder b)]) = _$LegalResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LegalResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LegalResponse> get serializer => _$LegalResponseSerializer();
}

class _$LegalResponseSerializer implements PrimitiveSerializer<LegalResponse> {
  @override
  final Iterable<Type> types = const [LegalResponse, _$LegalResponse];

  @override
  final String wireName = r'LegalResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LegalResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'documents';
    yield serializers.serialize(object.documents, specifiedType: const FullType(BuiltList, [FullType(LegalDocument)]));
    yield r'draft';
    yield serializers.serialize(object.draft, specifiedType: const FullType(bool));
    yield r'effectiveDate';
    yield serializers.serialize(object.effectiveDate, specifiedType: const FullType(String));
    yield r'version';
    yield serializers.serialize(object.version, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, LegalResponse object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LegalResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'documents':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(LegalDocument)]),
          ) as BuiltList<LegalDocument>;
          result.documents.replace(valueDes);
          break;
        case r'draft':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.draft = valueDes;
          break;
        case r'effectiveDate':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.effectiveDate = valueDes;
          break;
        case r'version':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.version = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LegalResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LegalResponseBuilder();
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
