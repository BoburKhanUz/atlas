// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_user.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfileUser extends ProfileUser {
  @override
  final DateTime createdAt;
  @override
  final String email;
  @override
  final String id;
  @override
  final String? name;
  @override
  final PreferencesRow? preferences;
  @override
  final ProfileRow? profile;

  factory _$ProfileUser([void Function(ProfileUserBuilder)? updates]) =>
      (ProfileUserBuilder()..update(updates))._build();

  _$ProfileUser._({
    required this.createdAt,
    required this.email,
    required this.id,
    this.name,
    this.preferences,
    this.profile,
  }) : super._();
  @override
  ProfileUser rebuild(void Function(ProfileUserBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ProfileUserBuilder toBuilder() => ProfileUserBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfileUser &&
        createdAt == other.createdAt &&
        email == other.email &&
        id == other.id &&
        name == other.name &&
        preferences == other.preferences &&
        profile == other.profile;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, email.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, preferences.hashCode);
    _$hash = $jc(_$hash, profile.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfileUser')
          ..add('createdAt', createdAt)
          ..add('email', email)
          ..add('id', id)
          ..add('name', name)
          ..add('preferences', preferences)
          ..add('profile', profile))
        .toString();
  }
}

class ProfileUserBuilder implements Builder<ProfileUser, ProfileUserBuilder> {
  _$ProfileUser? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _email;
  String? get email => _$this._email;
  set email(String? email) => _$this._email = email;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  PreferencesRowBuilder? _preferences;
  PreferencesRowBuilder get preferences => _$this._preferences ??= PreferencesRowBuilder();
  set preferences(PreferencesRowBuilder? preferences) => _$this._preferences = preferences;

  ProfileRowBuilder? _profile;
  ProfileRowBuilder get profile => _$this._profile ??= ProfileRowBuilder();
  set profile(ProfileRowBuilder? profile) => _$this._profile = profile;

  ProfileUserBuilder() {
    ProfileUser._defaults(this);
  }

  ProfileUserBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _email = $v.email;
      _id = $v.id;
      _name = $v.name;
      _preferences = $v.preferences?.toBuilder();
      _profile = $v.profile?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfileUser other) {
    _$v = other as _$ProfileUser;
  }

  @override
  void update(void Function(ProfileUserBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfileUser build() => _build();

  _$ProfileUser _build() {
    _$ProfileUser _$result;
    try {
      _$result =
          _$v ??
          _$ProfileUser._(
            createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'ProfileUser', 'createdAt'),
            email: BuiltValueNullFieldError.checkNotNull(email, r'ProfileUser', 'email'),
            id: BuiltValueNullFieldError.checkNotNull(id, r'ProfileUser', 'id'),
            name: name,
            preferences: _preferences?.build(),
            profile: _profile?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'preferences';
        _preferences?.build();
        _$failedField = 'profile';
        _profile?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ProfileUser', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
