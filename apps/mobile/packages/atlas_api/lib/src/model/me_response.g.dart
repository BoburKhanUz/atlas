// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MeResponse extends MeResponse {
  @override
  final bool consentRequired;
  @override
  final MeResponseUser user;

  factory _$MeResponse([void Function(MeResponseBuilder)? updates]) => (MeResponseBuilder()..update(updates))._build();

  _$MeResponse._({required this.consentRequired, required this.user}) : super._();
  @override
  MeResponse rebuild(void Function(MeResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  MeResponseBuilder toBuilder() => MeResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MeResponse && consentRequired == other.consentRequired && user == other.user;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, consentRequired.hashCode);
    _$hash = $jc(_$hash, user.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'MeResponse')
          ..add('consentRequired', consentRequired)
          ..add('user', user))
        .toString();
  }
}

class MeResponseBuilder implements Builder<MeResponse, MeResponseBuilder> {
  _$MeResponse? _$v;

  bool? _consentRequired;
  bool? get consentRequired => _$this._consentRequired;
  set consentRequired(bool? consentRequired) => _$this._consentRequired = consentRequired;

  MeResponseUserBuilder? _user;
  MeResponseUserBuilder get user => _$this._user ??= MeResponseUserBuilder();
  set user(MeResponseUserBuilder? user) => _$this._user = user;

  MeResponseBuilder() {
    MeResponse._defaults(this);
  }

  MeResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _consentRequired = $v.consentRequired;
      _user = $v.user.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MeResponse other) {
    _$v = other as _$MeResponse;
  }

  @override
  void update(void Function(MeResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MeResponse build() => _build();

  _$MeResponse _build() {
    _$MeResponse _$result;
    try {
      _$result =
          _$v ??
          _$MeResponse._(
            consentRequired: BuiltValueNullFieldError.checkNotNull(consentRequired, r'MeResponse', 'consentRequired'),
            user: user.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'user';
        user.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'MeResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
