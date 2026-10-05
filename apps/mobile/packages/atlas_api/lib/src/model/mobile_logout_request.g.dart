// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'mobile_logout_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MobileLogoutRequest extends MobileLogoutRequest {
  @override
  final String? refreshToken;

  factory _$MobileLogoutRequest([void Function(MobileLogoutRequestBuilder)? updates]) =>
      (MobileLogoutRequestBuilder()..update(updates))._build();

  _$MobileLogoutRequest._({this.refreshToken}) : super._();
  @override
  MobileLogoutRequest rebuild(void Function(MobileLogoutRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  MobileLogoutRequestBuilder toBuilder() => MobileLogoutRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MobileLogoutRequest && refreshToken == other.refreshToken;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, refreshToken.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'MobileLogoutRequest')..add('refreshToken', refreshToken)).toString();
  }
}

class MobileLogoutRequestBuilder implements Builder<MobileLogoutRequest, MobileLogoutRequestBuilder> {
  _$MobileLogoutRequest? _$v;

  String? _refreshToken;
  String? get refreshToken => _$this._refreshToken;
  set refreshToken(String? refreshToken) => _$this._refreshToken = refreshToken;

  MobileLogoutRequestBuilder() {
    MobileLogoutRequest._defaults(this);
  }

  MobileLogoutRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _refreshToken = $v.refreshToken;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MobileLogoutRequest other) {
    _$v = other as _$MobileLogoutRequest;
  }

  @override
  void update(void Function(MobileLogoutRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MobileLogoutRequest build() => _build();

  _$MobileLogoutRequest _build() {
    final _$result = _$v ?? _$MobileLogoutRequest._(refreshToken: refreshToken);
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
