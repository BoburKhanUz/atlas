// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'legal_section.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$LegalSection extends LegalSection {
  @override
  final String heading;
  @override
  final BuiltList<String> paragraphs;

  factory _$LegalSection([void Function(LegalSectionBuilder)? updates]) =>
      (LegalSectionBuilder()..update(updates))._build();

  _$LegalSection._({required this.heading, required this.paragraphs}) : super._();
  @override
  LegalSection rebuild(void Function(LegalSectionBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  LegalSectionBuilder toBuilder() => LegalSectionBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is LegalSection && heading == other.heading && paragraphs == other.paragraphs;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, heading.hashCode);
    _$hash = $jc(_$hash, paragraphs.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'LegalSection')
          ..add('heading', heading)
          ..add('paragraphs', paragraphs))
        .toString();
  }
}

class LegalSectionBuilder implements Builder<LegalSection, LegalSectionBuilder> {
  _$LegalSection? _$v;

  String? _heading;
  String? get heading => _$this._heading;
  set heading(String? heading) => _$this._heading = heading;

  ListBuilder<String>? _paragraphs;
  ListBuilder<String> get paragraphs => _$this._paragraphs ??= ListBuilder<String>();
  set paragraphs(ListBuilder<String>? paragraphs) => _$this._paragraphs = paragraphs;

  LegalSectionBuilder() {
    LegalSection._defaults(this);
  }

  LegalSectionBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _heading = $v.heading;
      _paragraphs = $v.paragraphs.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(LegalSection other) {
    _$v = other as _$LegalSection;
  }

  @override
  void update(void Function(LegalSectionBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  LegalSection build() => _build();

  _$LegalSection _build() {
    _$LegalSection _$result;
    try {
      _$result =
          _$v ??
          _$LegalSection._(
            heading: BuiltValueNullFieldError.checkNotNull(heading, r'LegalSection', 'heading'),
            paragraphs: paragraphs.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'paragraphs';
        paragraphs.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'LegalSection', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
