// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_patch_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfilePatchRequest extends ProfilePatchRequest {
  @override
  final String? name;
  @override
  final ProfilePatchRequestPreferences? preferences;
  @override
  final ProfilePatchRequestProfile? profile;

  factory _$ProfilePatchRequest([void Function(ProfilePatchRequestBuilder)? updates]) =>
      (ProfilePatchRequestBuilder()..update(updates))._build();

  _$ProfilePatchRequest._({this.name, this.preferences, this.profile}) : super._();
  @override
  ProfilePatchRequest rebuild(void Function(ProfilePatchRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ProfilePatchRequestBuilder toBuilder() => ProfilePatchRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfilePatchRequest &&
        name == other.name &&
        preferences == other.preferences &&
        profile == other.profile;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, preferences.hashCode);
    _$hash = $jc(_$hash, profile.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfilePatchRequest')
          ..add('name', name)
          ..add('preferences', preferences)
          ..add('profile', profile))
        .toString();
  }
}

class ProfilePatchRequestBuilder implements Builder<ProfilePatchRequest, ProfilePatchRequestBuilder> {
  _$ProfilePatchRequest? _$v;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  ProfilePatchRequestPreferencesBuilder? _preferences;
  ProfilePatchRequestPreferencesBuilder get preferences =>
      _$this._preferences ??= ProfilePatchRequestPreferencesBuilder();
  set preferences(ProfilePatchRequestPreferencesBuilder? preferences) => _$this._preferences = preferences;

  ProfilePatchRequestProfileBuilder? _profile;
  ProfilePatchRequestProfileBuilder get profile => _$this._profile ??= ProfilePatchRequestProfileBuilder();
  set profile(ProfilePatchRequestProfileBuilder? profile) => _$this._profile = profile;

  ProfilePatchRequestBuilder() {
    ProfilePatchRequest._defaults(this);
  }

  ProfilePatchRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _name = $v.name;
      _preferences = $v.preferences?.toBuilder();
      _profile = $v.profile?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfilePatchRequest other) {
    _$v = other as _$ProfilePatchRequest;
  }

  @override
  void update(void Function(ProfilePatchRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfilePatchRequest build() => _build();

  _$ProfilePatchRequest _build() {
    _$ProfilePatchRequest _$result;
    try {
      _$result =
          _$v ?? _$ProfilePatchRequest._(name: name, preferences: _preferences?.build(), profile: _profile?.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'preferences';
        _preferences?.build();
        _$failedField = 'profile';
        _profile?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ProfilePatchRequest', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
