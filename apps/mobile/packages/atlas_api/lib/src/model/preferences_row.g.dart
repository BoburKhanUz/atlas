// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'preferences_row.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$PreferencesRow extends PreferencesRow {
  @override
  final String id;
  @override
  final String language;
  @override
  final String userId;

  factory _$PreferencesRow([void Function(PreferencesRowBuilder)? updates]) =>
      (PreferencesRowBuilder()..update(updates))._build();

  _$PreferencesRow._({required this.id, required this.language, required this.userId}) : super._();
  @override
  PreferencesRow rebuild(void Function(PreferencesRowBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  PreferencesRowBuilder toBuilder() => PreferencesRowBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is PreferencesRow && id == other.id && language == other.language && userId == other.userId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, language.hashCode);
    _$hash = $jc(_$hash, userId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'PreferencesRow')
          ..add('id', id)
          ..add('language', language)
          ..add('userId', userId))
        .toString();
  }
}

class PreferencesRowBuilder implements Builder<PreferencesRow, PreferencesRowBuilder> {
  _$PreferencesRow? _$v;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _language;
  String? get language => _$this._language;
  set language(String? language) => _$this._language = language;

  String? _userId;
  String? get userId => _$this._userId;
  set userId(String? userId) => _$this._userId = userId;

  PreferencesRowBuilder() {
    PreferencesRow._defaults(this);
  }

  PreferencesRowBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _language = $v.language;
      _userId = $v.userId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(PreferencesRow other) {
    _$v = other as _$PreferencesRow;
  }

  @override
  void update(void Function(PreferencesRowBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  PreferencesRow build() => _build();

  _$PreferencesRow _build() {
    final _$result =
        _$v ??
        _$PreferencesRow._(
          id: BuiltValueNullFieldError.checkNotNull(id, r'PreferencesRow', 'id'),
          language: BuiltValueNullFieldError.checkNotNull(language, r'PreferencesRow', 'language'),
          userId: BuiltValueNullFieldError.checkNotNull(userId, r'PreferencesRow', 'userId'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
