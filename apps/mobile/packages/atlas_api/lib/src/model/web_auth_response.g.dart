// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'web_auth_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WebAuthResponse extends WebAuthResponse {
  @override
  final SessionUser user;

  factory _$WebAuthResponse([void Function(WebAuthResponseBuilder)? updates]) =>
      (WebAuthResponseBuilder()..update(updates))._build();

  _$WebAuthResponse._({required this.user}) : super._();
  @override
  WebAuthResponse rebuild(void Function(WebAuthResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  WebAuthResponseBuilder toBuilder() => WebAuthResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WebAuthResponse && user == other.user;
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
    return (newBuiltValueToStringHelper(r'WebAuthResponse')..add('user', user)).toString();
  }
}

class WebAuthResponseBuilder implements Builder<WebAuthResponse, WebAuthResponseBuilder> {
  _$WebAuthResponse? _$v;

  SessionUserBuilder? _user;
  SessionUserBuilder get user => _$this._user ??= SessionUserBuilder();
  set user(SessionUserBuilder? user) => _$this._user = user;

  WebAuthResponseBuilder() {
    WebAuthResponse._defaults(this);
  }

  WebAuthResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _user = $v.user.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WebAuthResponse other) {
    _$v = other as _$WebAuthResponse;
  }

  @override
  void update(void Function(WebAuthResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WebAuthResponse build() => _build();

  _$WebAuthResponse _build() {
    _$WebAuthResponse _$result;
    try {
      _$result = _$v ?? _$WebAuthResponse._(user: user.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'user';
        user.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WebAuthResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
