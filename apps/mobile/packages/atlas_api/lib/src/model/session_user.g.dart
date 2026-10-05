// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session_user.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$SessionUser extends SessionUser {
  @override
  final String email;
  @override
  final String id;
  @override
  final String? name;

  factory _$SessionUser([void Function(SessionUserBuilder)? updates]) =>
      (SessionUserBuilder()..update(updates))._build();

  _$SessionUser._({required this.email, required this.id, this.name}) : super._();
  @override
  SessionUser rebuild(void Function(SessionUserBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  SessionUserBuilder toBuilder() => SessionUserBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is SessionUser && email == other.email && id == other.id && name == other.name;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, email.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'SessionUser')
          ..add('email', email)
          ..add('id', id)
          ..add('name', name))
        .toString();
  }
}

class SessionUserBuilder implements Builder<SessionUser, SessionUserBuilder> {
  _$SessionUser? _$v;

  String? _email;
  String? get email => _$this._email;
  set email(String? email) => _$this._email = email;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  SessionUserBuilder() {
    SessionUser._defaults(this);
  }

  SessionUserBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _email = $v.email;
      _id = $v.id;
      _name = $v.name;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(SessionUser other) {
    _$v = other as _$SessionUser;
  }

  @override
  void update(void Function(SessionUserBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  SessionUser build() => _build();

  _$SessionUser _build() {
    final _$result =
        _$v ??
        _$SessionUser._(
          email: BuiltValueNullFieldError.checkNotNull(email, r'SessionUser', 'email'),
          id: BuiltValueNullFieldError.checkNotNull(id, r'SessionUser', 'id'),
          name: name,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
