// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'password_reset_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$PasswordResetRequest extends PasswordResetRequest {
  @override
  final String password;
  @override
  final String token;

  factory _$PasswordResetRequest([void Function(PasswordResetRequestBuilder)? updates]) =>
      (PasswordResetRequestBuilder()..update(updates))._build();

  _$PasswordResetRequest._({required this.password, required this.token}) : super._();
  @override
  PasswordResetRequest rebuild(void Function(PasswordResetRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  PasswordResetRequestBuilder toBuilder() => PasswordResetRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is PasswordResetRequest && password == other.password && token == other.token;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, password.hashCode);
    _$hash = $jc(_$hash, token.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'PasswordResetRequest')
          ..add('password', password)
          ..add('token', token))
        .toString();
  }
}

class PasswordResetRequestBuilder implements Builder<PasswordResetRequest, PasswordResetRequestBuilder> {
  _$PasswordResetRequest? _$v;

  String? _password;
  String? get password => _$this._password;
  set password(String? password) => _$this._password = password;

  String? _token;
  String? get token => _$this._token;
  set token(String? token) => _$this._token = token;

  PasswordResetRequestBuilder() {
    PasswordResetRequest._defaults(this);
  }

  PasswordResetRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _password = $v.password;
      _token = $v.token;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(PasswordResetRequest other) {
    _$v = other as _$PasswordResetRequest;
  }

  @override
  void update(void Function(PasswordResetRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  PasswordResetRequest build() => _build();

  _$PasswordResetRequest _build() {
    final _$result =
        _$v ??
        _$PasswordResetRequest._(
          password: BuiltValueNullFieldError.checkNotNull(password, r'PasswordResetRequest', 'password'),
          token: BuiltValueNullFieldError.checkNotNull(token, r'PasswordResetRequest', 'token'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
