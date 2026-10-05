// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_patch_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfilePatchResponse extends ProfilePatchResponse {
  @override
  final ProfilePatchResponseUser user;

  factory _$ProfilePatchResponse([void Function(ProfilePatchResponseBuilder)? updates]) =>
      (ProfilePatchResponseBuilder()..update(updates))._build();

  _$ProfilePatchResponse._({required this.user}) : super._();
  @override
  ProfilePatchResponse rebuild(void Function(ProfilePatchResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ProfilePatchResponseBuilder toBuilder() => ProfilePatchResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfilePatchResponse && user == other.user;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, user.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfilePatchResponse')..add('user', user)).toString();
  }
}

class ProfilePatchResponseBuilder implements Builder<ProfilePatchResponse, ProfilePatchResponseBuilder> {
  _$ProfilePatchResponse? _$v;

  ProfilePatchResponseUserBuilder? _user;
  ProfilePatchResponseUserBuilder get user => _$this._user ??= ProfilePatchResponseUserBuilder();
  set user(ProfilePatchResponseUserBuilder? user) => _$this._user = user;

  ProfilePatchResponseBuilder() {
    ProfilePatchResponse._defaults(this);
  }

  ProfilePatchResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _user = $v.user.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfilePatchResponse other) {
    _$v = other as _$ProfilePatchResponse;
  }

  @override
  void update(void Function(ProfilePatchResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfilePatchResponse build() => _build();

  _$ProfilePatchResponse _build() {
    _$ProfilePatchResponse _$result;
    try {
      _$result = _$v ?? _$ProfilePatchResponse._(user: user.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'user';
        user.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ProfilePatchResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
