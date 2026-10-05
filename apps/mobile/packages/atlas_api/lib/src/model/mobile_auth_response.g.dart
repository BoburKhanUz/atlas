// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'mobile_auth_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MobileAuthResponse extends MobileAuthResponse {
  @override
  final String accessToken;
  @override
  final DateTime accessTokenExpiresAt;
  @override
  final String refreshToken;
  @override
  final DateTime refreshTokenExpiresAt;
  @override
  final DateTime sessionExpiresAt;
  @override
  final SessionUser user;

  factory _$MobileAuthResponse([void Function(MobileAuthResponseBuilder)? updates]) =>
      (MobileAuthResponseBuilder()..update(updates))._build();

  _$MobileAuthResponse._({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
    required this.sessionExpiresAt,
    required this.user,
  }) : super._();
  @override
  MobileAuthResponse rebuild(void Function(MobileAuthResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  MobileAuthResponseBuilder toBuilder() => MobileAuthResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MobileAuthResponse &&
        accessToken == other.accessToken &&
        accessTokenExpiresAt == other.accessTokenExpiresAt &&
        refreshToken == other.refreshToken &&
        refreshTokenExpiresAt == other.refreshTokenExpiresAt &&
        sessionExpiresAt == other.sessionExpiresAt &&
        user == other.user;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, accessToken.hashCode);
    _$hash = $jc(_$hash, accessTokenExpiresAt.hashCode);
    _$hash = $jc(_$hash, refreshToken.hashCode);
    _$hash = $jc(_$hash, refreshTokenExpiresAt.hashCode);
    _$hash = $jc(_$hash, sessionExpiresAt.hashCode);
    _$hash = $jc(_$hash, user.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'MobileAuthResponse')
          ..add('accessToken', accessToken)
          ..add('accessTokenExpiresAt', accessTokenExpiresAt)
          ..add('refreshToken', refreshToken)
          ..add('refreshTokenExpiresAt', refreshTokenExpiresAt)
          ..add('sessionExpiresAt', sessionExpiresAt)
          ..add('user', user))
        .toString();
  }
}

class MobileAuthResponseBuilder implements Builder<MobileAuthResponse, MobileAuthResponseBuilder> {
  _$MobileAuthResponse? _$v;

  String? _accessToken;
  String? get accessToken => _$this._accessToken;
  set accessToken(String? accessToken) => _$this._accessToken = accessToken;

  DateTime? _accessTokenExpiresAt;
  DateTime? get accessTokenExpiresAt => _$this._accessTokenExpiresAt;
  set accessTokenExpiresAt(DateTime? accessTokenExpiresAt) => _$this._accessTokenExpiresAt = accessTokenExpiresAt;

  String? _refreshToken;
  String? get refreshToken => _$this._refreshToken;
  set refreshToken(String? refreshToken) => _$this._refreshToken = refreshToken;

  DateTime? _refreshTokenExpiresAt;
  DateTime? get refreshTokenExpiresAt => _$this._refreshTokenExpiresAt;
  set refreshTokenExpiresAt(DateTime? refreshTokenExpiresAt) => _$this._refreshTokenExpiresAt = refreshTokenExpiresAt;

  DateTime? _sessionExpiresAt;
  DateTime? get sessionExpiresAt => _$this._sessionExpiresAt;
  set sessionExpiresAt(DateTime? sessionExpiresAt) => _$this._sessionExpiresAt = sessionExpiresAt;

  SessionUserBuilder? _user;
  SessionUserBuilder get user => _$this._user ??= SessionUserBuilder();
  set user(SessionUserBuilder? user) => _$this._user = user;

  MobileAuthResponseBuilder() {
    MobileAuthResponse._defaults(this);
  }

  MobileAuthResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _accessToken = $v.accessToken;
      _accessTokenExpiresAt = $v.accessTokenExpiresAt;
      _refreshToken = $v.refreshToken;
      _refreshTokenExpiresAt = $v.refreshTokenExpiresAt;
      _sessionExpiresAt = $v.sessionExpiresAt;
      _user = $v.user.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MobileAuthResponse other) {
    _$v = other as _$MobileAuthResponse;
  }

  @override
  void update(void Function(MobileAuthResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MobileAuthResponse build() => _build();

  _$MobileAuthResponse _build() {
    _$MobileAuthResponse _$result;
    try {
      _$result =
          _$v ??
          _$MobileAuthResponse._(
            accessToken: BuiltValueNullFieldError.checkNotNull(accessToken, r'MobileAuthResponse', 'accessToken'),
            accessTokenExpiresAt: BuiltValueNullFieldError.checkNotNull(
              accessTokenExpiresAt,
              r'MobileAuthResponse',
              'accessTokenExpiresAt',
            ),
            refreshToken: BuiltValueNullFieldError.checkNotNull(refreshToken, r'MobileAuthResponse', 'refreshToken'),
            refreshTokenExpiresAt: BuiltValueNullFieldError.checkNotNull(
              refreshTokenExpiresAt,
              r'MobileAuthResponse',
              'refreshTokenExpiresAt',
            ),
            sessionExpiresAt: BuiltValueNullFieldError.checkNotNull(
              sessionExpiresAt,
              r'MobileAuthResponse',
              'sessionExpiresAt',
            ),
            user: user.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'user';
        user.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'MobileAuthResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
