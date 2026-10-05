// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_patch_response_user.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfilePatchResponseUser extends ProfilePatchResponseUser {
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

  factory _$ProfilePatchResponseUser([void Function(ProfilePatchResponseUserBuilder)? updates]) =>
      (ProfilePatchResponseUserBuilder()..update(updates))._build();

  _$ProfilePatchResponseUser._({required this.email, required this.id, this.name, this.preferences, this.profile})
    : super._();
  @override
  ProfilePatchResponseUser rebuild(void Function(ProfilePatchResponseUserBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ProfilePatchResponseUserBuilder toBuilder() => ProfilePatchResponseUserBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfilePatchResponseUser &&
        email == other.email &&
        id == other.id &&
        name == other.name &&
        preferences == other.preferences &&
        profile == other.profile;
  }

  @override
  int get hashCode {
    var _$hash = 0;
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
    return (newBuiltValueToStringHelper(r'ProfilePatchResponseUser')
          ..add('email', email)
          ..add('id', id)
          ..add('name', name)
          ..add('preferences', preferences)
          ..add('profile', profile))
        .toString();
  }
}

class ProfilePatchResponseUserBuilder implements Builder<ProfilePatchResponseUser, ProfilePatchResponseUserBuilder> {
  _$ProfilePatchResponseUser? _$v;

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

  ProfilePatchResponseUserBuilder() {
    ProfilePatchResponseUser._defaults(this);
  }

  ProfilePatchResponseUserBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
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
  void replace(ProfilePatchResponseUser other) {
    _$v = other as _$ProfilePatchResponseUser;
  }

  @override
  void update(void Function(ProfilePatchResponseUserBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfilePatchResponseUser build() => _build();

  _$ProfilePatchResponseUser _build() {
    _$ProfilePatchResponseUser _$result;
    try {
      _$result =
          _$v ??
          _$ProfilePatchResponseUser._(
            email: BuiltValueNullFieldError.checkNotNull(email, r'ProfilePatchResponseUser', 'email'),
            id: BuiltValueNullFieldError.checkNotNull(id, r'ProfilePatchResponseUser', 'id'),
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
        throw BuiltValueNestedFieldError(r'ProfilePatchResponseUser', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
