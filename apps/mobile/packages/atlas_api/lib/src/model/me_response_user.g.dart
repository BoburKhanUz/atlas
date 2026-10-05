// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_response_user.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MeResponseUser extends MeResponseUser {
  @override
  final DateTime createdAt;
  @override
  final String email;
  @override
  final String id;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? name;

  factory _$MeResponseUser([void Function(MeResponseUserBuilder)? updates]) =>
      (MeResponseUserBuilder()..update(updates))._build();

  _$MeResponseUser._({required this.createdAt, required this.email, required this.id, this.name}) : super._();
  @override
  MeResponseUser rebuild(void Function(MeResponseUserBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  MeResponseUserBuilder toBuilder() => MeResponseUserBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MeResponseUser &&
        createdAt == other.createdAt &&
        email == other.email &&
        id == other.id &&
        name == other.name;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, email.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'MeResponseUser')
          ..add('createdAt', createdAt)
          ..add('email', email)
          ..add('id', id)
          ..add('name', name))
        .toString();
  }
}

class MeResponseUserBuilder implements Builder<MeResponseUser, MeResponseUserBuilder> {
  _$MeResponseUser? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _email;
  String? get email => _$this._email;
  set email(String? email) => _$this._email = email;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _name;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get name =>
      _$this._name ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set name(ColorAnalysisResponseColorProfileContrastLevelBuilder? name) => _$this._name = name;

  MeResponseUserBuilder() {
    MeResponseUser._defaults(this);
  }

  MeResponseUserBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _email = $v.email;
      _id = $v.id;
      _name = $v.name?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MeResponseUser other) {
    _$v = other as _$MeResponseUser;
  }

  @override
  void update(void Function(MeResponseUserBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MeResponseUser build() => _build();

  _$MeResponseUser _build() {
    _$MeResponseUser _$result;
    try {
      _$result =
          _$v ??
          _$MeResponseUser._(
            createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'MeResponseUser', 'createdAt'),
            email: BuiltValueNullFieldError.checkNotNull(email, r'MeResponseUser', 'email'),
            id: BuiltValueNullFieldError.checkNotNull(id, r'MeResponseUser', 'id'),
            name: _name?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'name';
        _name?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'MeResponseUser', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
