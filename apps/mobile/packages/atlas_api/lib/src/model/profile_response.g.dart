// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfileResponse extends ProfileResponse {
  @override
  final ProfilePreferences? preferences;
  @override
  final ProfileRow? profile;
  @override
  final ProfileUser user;

  factory _$ProfileResponse([void Function(ProfileResponseBuilder)? updates]) =>
      (ProfileResponseBuilder()..update(updates))._build();

  _$ProfileResponse._({this.preferences, this.profile, required this.user}) : super._();
  @override
  ProfileResponse rebuild(void Function(ProfileResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ProfileResponseBuilder toBuilder() => ProfileResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfileResponse &&
        preferences == other.preferences &&
        profile == other.profile &&
        user == other.user;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, preferences.hashCode);
    _$hash = $jc(_$hash, profile.hashCode);
    _$hash = $jc(_$hash, user.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfileResponse')
          ..add('preferences', preferences)
          ..add('profile', profile)
          ..add('user', user))
        .toString();
  }
}

class ProfileResponseBuilder implements Builder<ProfileResponse, ProfileResponseBuilder> {
  _$ProfileResponse? _$v;

  ProfilePreferencesBuilder? _preferences;
  ProfilePreferencesBuilder get preferences => _$this._preferences ??= ProfilePreferencesBuilder();
  set preferences(ProfilePreferencesBuilder? preferences) => _$this._preferences = preferences;

  ProfileRowBuilder? _profile;
  ProfileRowBuilder get profile => _$this._profile ??= ProfileRowBuilder();
  set profile(ProfileRowBuilder? profile) => _$this._profile = profile;

  ProfileUserBuilder? _user;
  ProfileUserBuilder get user => _$this._user ??= ProfileUserBuilder();
  set user(ProfileUserBuilder? user) => _$this._user = user;

  ProfileResponseBuilder() {
    ProfileResponse._defaults(this);
  }

  ProfileResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _preferences = $v.preferences?.toBuilder();
      _profile = $v.profile?.toBuilder();
      _user = $v.user.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfileResponse other) {
    _$v = other as _$ProfileResponse;
  }

  @override
  void update(void Function(ProfileResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfileResponse build() => _build();

  _$ProfileResponse _build() {
    _$ProfileResponse _$result;
    try {
      _$result =
          _$v ??
          _$ProfileResponse._(preferences: _preferences?.build(), profile: _profile?.build(), user: user.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'preferences';
        _preferences?.build();
        _$failedField = 'profile';
        _profile?.build();
        _$failedField = 'user';
        user.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ProfileResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
