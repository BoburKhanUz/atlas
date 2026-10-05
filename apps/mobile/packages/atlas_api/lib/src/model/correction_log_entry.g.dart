// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'correction_log_entry.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$CorrectionLogEntry extends CorrectionLogEntry {
  @override
  final DateTime at;
  @override
  final String field;
  @override
  final String from;
  @override
  final String to;

  factory _$CorrectionLogEntry([void Function(CorrectionLogEntryBuilder)? updates]) =>
      (CorrectionLogEntryBuilder()..update(updates))._build();

  _$CorrectionLogEntry._({required this.at, required this.field, required this.from, required this.to}) : super._();
  @override
  CorrectionLogEntry rebuild(void Function(CorrectionLogEntryBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  CorrectionLogEntryBuilder toBuilder() => CorrectionLogEntryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is CorrectionLogEntry &&
        at == other.at &&
        field == other.field &&
        from == other.from &&
        to == other.to;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, at.hashCode);
    _$hash = $jc(_$hash, field.hashCode);
    _$hash = $jc(_$hash, from.hashCode);
    _$hash = $jc(_$hash, to.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'CorrectionLogEntry')
          ..add('at', at)
          ..add('field', field)
          ..add('from', from)
          ..add('to', to))
        .toString();
  }
}

class CorrectionLogEntryBuilder implements Builder<CorrectionLogEntry, CorrectionLogEntryBuilder> {
  _$CorrectionLogEntry? _$v;

  DateTime? _at;
  DateTime? get at => _$this._at;
  set at(DateTime? at) => _$this._at = at;

  String? _field;
  String? get field => _$this._field;
  set field(String? field) => _$this._field = field;

  String? _from;
  String? get from => _$this._from;
  set from(String? from) => _$this._from = from;

  String? _to;
  String? get to => _$this._to;
  set to(String? to) => _$this._to = to;

  CorrectionLogEntryBuilder() {
    CorrectionLogEntry._defaults(this);
  }

  CorrectionLogEntryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _at = $v.at;
      _field = $v.field;
      _from = $v.from;
      _to = $v.to;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(CorrectionLogEntry other) {
    _$v = other as _$CorrectionLogEntry;
  }

  @override
  void update(void Function(CorrectionLogEntryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  CorrectionLogEntry build() => _build();

  _$CorrectionLogEntry _build() {
    final _$result =
        _$v ??
        _$CorrectionLogEntry._(
          at: BuiltValueNullFieldError.checkNotNull(at, r'CorrectionLogEntry', 'at'),
          field: BuiltValueNullFieldError.checkNotNull(field, r'CorrectionLogEntry', 'field'),
          from: BuiltValueNullFieldError.checkNotNull(from, r'CorrectionLogEntry', 'from'),
          to: BuiltValueNullFieldError.checkNotNull(to, r'CorrectionLogEntry', 'to'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
