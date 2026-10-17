// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'legal_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$LegalResponse extends LegalResponse {
  @override
  final BuiltList<LegalDocument> documents;
  @override
  final bool draft;
  @override
  final String effectiveDate;
  @override
  final String version;

  factory _$LegalResponse([void Function(LegalResponseBuilder)? updates]) =>
      (LegalResponseBuilder()..update(updates))._build();

  _$LegalResponse._({required this.documents, required this.draft, required this.effectiveDate, required this.version})
    : super._();
  @override
  LegalResponse rebuild(void Function(LegalResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  LegalResponseBuilder toBuilder() => LegalResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is LegalResponse &&
        documents == other.documents &&
        draft == other.draft &&
        effectiveDate == other.effectiveDate &&
        version == other.version;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, documents.hashCode);
    _$hash = $jc(_$hash, draft.hashCode);
    _$hash = $jc(_$hash, effectiveDate.hashCode);
    _$hash = $jc(_$hash, version.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'LegalResponse')
          ..add('documents', documents)
          ..add('draft', draft)
          ..add('effectiveDate', effectiveDate)
          ..add('version', version))
        .toString();
  }
}

class LegalResponseBuilder implements Builder<LegalResponse, LegalResponseBuilder> {
  _$LegalResponse? _$v;

  ListBuilder<LegalDocument>? _documents;
  ListBuilder<LegalDocument> get documents => _$this._documents ??= ListBuilder<LegalDocument>();
  set documents(ListBuilder<LegalDocument>? documents) => _$this._documents = documents;

  bool? _draft;
  bool? get draft => _$this._draft;
  set draft(bool? draft) => _$this._draft = draft;

  String? _effectiveDate;
  String? get effectiveDate => _$this._effectiveDate;
  set effectiveDate(String? effectiveDate) => _$this._effectiveDate = effectiveDate;

  String? _version;
  String? get version => _$this._version;
  set version(String? version) => _$this._version = version;

  LegalResponseBuilder() {
    LegalResponse._defaults(this);
  }

  LegalResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _documents = $v.documents.toBuilder();
      _draft = $v.draft;
      _effectiveDate = $v.effectiveDate;
      _version = $v.version;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(LegalResponse other) {
    _$v = other as _$LegalResponse;
  }

  @override
  void update(void Function(LegalResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  LegalResponse build() => _build();

  _$LegalResponse _build() {
    _$LegalResponse _$result;
    try {
      _$result =
          _$v ??
          _$LegalResponse._(
            documents: documents.build(),
            draft: BuiltValueNullFieldError.checkNotNull(draft, r'LegalResponse', 'draft'),
            effectiveDate: BuiltValueNullFieldError.checkNotNull(effectiveDate, r'LegalResponse', 'effectiveDate'),
            version: BuiltValueNullFieldError.checkNotNull(version, r'LegalResponse', 'version'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'documents';
        documents.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'LegalResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
