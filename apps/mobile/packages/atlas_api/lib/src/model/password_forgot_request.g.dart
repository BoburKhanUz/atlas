// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'password_forgot_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$PasswordForgotRequest extends PasswordForgotRequest {
  @override
  final String email;

  factory _$PasswordForgotRequest([void Function(PasswordForgotRequestBuilder)? updates]) =>
      (PasswordForgotRequestBuilder()..update(updates))._build();

  _$PasswordForgotRequest._({required this.email}) : super._();
  @override
  PasswordForgotRequest rebuild(void Function(PasswordForgotRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  PasswordForgotRequestBuilder toBuilder() => PasswordForgotRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is PasswordForgotRequest && email == other.email;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, email.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'PasswordForgotRequest')..add('email', email)).toString();
  }
}

class PasswordForgotRequestBuilder implements Builder<PasswordForgotRequest, PasswordForgotRequestBuilder> {
  _$PasswordForgotRequest? _$v;

  String? _email;
  String? get email => _$this._email;
  set email(String? email) => _$this._email = email;

  PasswordForgotRequestBuilder() {
    PasswordForgotRequest._defaults(this);
  }

  PasswordForgotRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _email = $v.email;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(PasswordForgotRequest other) {
    _$v = other as _$PasswordForgotRequest;
  }

  @override
  void update(void Function(PasswordForgotRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  PasswordForgotRequest build() => _build();

  _$PasswordForgotRequest _build() {
    final _$result =
        _$v ??
        _$PasswordForgotRequest._(
          email: BuiltValueNullFieldError.checkNotNull(email, r'PasswordForgotRequest', 'email'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
