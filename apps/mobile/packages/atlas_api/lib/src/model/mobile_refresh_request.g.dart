// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'mobile_refresh_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MobileRefreshRequest extends MobileRefreshRequest {
  @override
  final String refreshToken;

  factory _$MobileRefreshRequest([void Function(MobileRefreshRequestBuilder)? updates]) =>
      (MobileRefreshRequestBuilder()..update(updates))._build();

  _$MobileRefreshRequest._({required this.refreshToken}) : super._();
  @override
  MobileRefreshRequest rebuild(void Function(MobileRefreshRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  MobileRefreshRequestBuilder toBuilder() => MobileRefreshRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MobileRefreshRequest && refreshToken == other.refreshToken;
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
    return (newBuiltValueToStringHelper(r'MobileRefreshRequest')..add('refreshToken', refreshToken)).toString();
  }
}

class MobileRefreshRequestBuilder implements Builder<MobileRefreshRequest, MobileRefreshRequestBuilder> {
  _$MobileRefreshRequest? _$v;

  String? _refreshToken;
  String? get refreshToken => _$this._refreshToken;
  set refreshToken(String? refreshToken) => _$this._refreshToken = refreshToken;

  MobileRefreshRequestBuilder() {
    MobileRefreshRequest._defaults(this);
  }

  MobileRefreshRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _refreshToken = $v.refreshToken;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MobileRefreshRequest other) {
    _$v = other as _$MobileRefreshRequest;
  }

  @override
  void update(void Function(MobileRefreshRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MobileRefreshRequest build() => _build();

  _$MobileRefreshRequest _build() {
    final _$result =
        _$v ??
        _$MobileRefreshRequest._(
          refreshToken: BuiltValueNullFieldError.checkNotNull(refreshToken, r'MobileRefreshRequest', 'refreshToken'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
