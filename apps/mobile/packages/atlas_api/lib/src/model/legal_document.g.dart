// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'legal_document.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const LegalDocumentIdEnum _$legalDocumentIdEnum_privacy = const LegalDocumentIdEnum._('privacy');
const LegalDocumentIdEnum _$legalDocumentIdEnum_terms = const LegalDocumentIdEnum._('terms');
const LegalDocumentIdEnum _$legalDocumentIdEnum_unknownDefaultOpenApi = const LegalDocumentIdEnum._(
  'unknownDefaultOpenApi',
);

LegalDocumentIdEnum _$legalDocumentIdEnumValueOf(String name) {
  switch (name) {
    case 'privacy':
      return _$legalDocumentIdEnum_privacy;
    case 'terms':
      return _$legalDocumentIdEnum_terms;
    case 'unknownDefaultOpenApi':
      return _$legalDocumentIdEnum_unknownDefaultOpenApi;
    default:
      return _$legalDocumentIdEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<LegalDocumentIdEnum> _$legalDocumentIdEnumValues = BuiltSet<LegalDocumentIdEnum>(
  const <LegalDocumentIdEnum>[
    _$legalDocumentIdEnum_privacy,
    _$legalDocumentIdEnum_terms,
    _$legalDocumentIdEnum_unknownDefaultOpenApi,
  ],
);

Serializer<LegalDocumentIdEnum> _$legalDocumentIdEnumSerializer = _$LegalDocumentIdEnumSerializer();

class _$LegalDocumentIdEnumSerializer implements PrimitiveSerializer<LegalDocumentIdEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'privacy': 'privacy',
    'terms': 'terms',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'privacy': 'privacy',
    'terms': 'terms',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[LegalDocumentIdEnum];
  @override
  final String wireName = 'LegalDocumentIdEnum';

  @override
  Object serialize(
    Serializers serializers,
    LegalDocumentIdEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  LegalDocumentIdEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => LegalDocumentIdEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$LegalDocument extends LegalDocument {
  @override
  final LegalDocumentIdEnum id;
  @override
  final BuiltList<LegalSection> sections;
  @override
  final String title;

  factory _$LegalDocument([void Function(LegalDocumentBuilder)? updates]) =>
      (LegalDocumentBuilder()..update(updates))._build();

  _$LegalDocument._({required this.id, required this.sections, required this.title}) : super._();
  @override
  LegalDocument rebuild(void Function(LegalDocumentBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  LegalDocumentBuilder toBuilder() => LegalDocumentBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is LegalDocument && id == other.id && sections == other.sections && title == other.title;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, sections.hashCode);
    _$hash = $jc(_$hash, title.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'LegalDocument')
          ..add('id', id)
          ..add('sections', sections)
          ..add('title', title))
        .toString();
  }
}

class LegalDocumentBuilder implements Builder<LegalDocument, LegalDocumentBuilder> {
  _$LegalDocument? _$v;

  LegalDocumentIdEnum? _id;
  LegalDocumentIdEnum? get id => _$this._id;
  set id(LegalDocumentIdEnum? id) => _$this._id = id;

  ListBuilder<LegalSection>? _sections;
  ListBuilder<LegalSection> get sections => _$this._sections ??= ListBuilder<LegalSection>();
  set sections(ListBuilder<LegalSection>? sections) => _$this._sections = sections;

  String? _title;
  String? get title => _$this._title;
  set title(String? title) => _$this._title = title;

  LegalDocumentBuilder() {
    LegalDocument._defaults(this);
  }

  LegalDocumentBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _sections = $v.sections.toBuilder();
      _title = $v.title;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(LegalDocument other) {
    _$v = other as _$LegalDocument;
  }

  @override
  void update(void Function(LegalDocumentBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  LegalDocument build() => _build();

  _$LegalDocument _build() {
    _$LegalDocument _$result;
    try {
      _$result =
          _$v ??
          _$LegalDocument._(
            id: BuiltValueNullFieldError.checkNotNull(id, r'LegalDocument', 'id'),
            sections: sections.build(),
            title: BuiltValueNullFieldError.checkNotNull(title, r'LegalDocument', 'title'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'sections';
        sections.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'LegalDocument', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
