// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'legal_consent_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$LegalConsentRequest extends LegalConsentRequest {
  @override
  final String acceptedLegalVersion;
  @override
  final bool ageConfirmed;

  factory _$LegalConsentRequest([void Function(LegalConsentRequestBuilder)? updates]) =>
      (LegalConsentRequestBuilder()..update(updates))._build();

  _$LegalConsentRequest._({required this.acceptedLegalVersion, required this.ageConfirmed}) : super._();
  @override
  LegalConsentRequest rebuild(void Function(LegalConsentRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  LegalConsentRequestBuilder toBuilder() => LegalConsentRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is LegalConsentRequest &&
        acceptedLegalVersion == other.acceptedLegalVersion &&
        ageConfirmed == other.ageConfirmed;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, acceptedLegalVersion.hashCode);
    _$hash = $jc(_$hash, ageConfirmed.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'LegalConsentRequest')
          ..add('acceptedLegalVersion', acceptedLegalVersion)
          ..add('ageConfirmed', ageConfirmed))
        .toString();
  }
}

class LegalConsentRequestBuilder implements Builder<LegalConsentRequest, LegalConsentRequestBuilder> {
  _$LegalConsentRequest? _$v;

  String? _acceptedLegalVersion;
  String? get acceptedLegalVersion => _$this._acceptedLegalVersion;
  set acceptedLegalVersion(String? acceptedLegalVersion) => _$this._acceptedLegalVersion = acceptedLegalVersion;

  bool? _ageConfirmed;
  bool? get ageConfirmed => _$this._ageConfirmed;
  set ageConfirmed(bool? ageConfirmed) => _$this._ageConfirmed = ageConfirmed;

  LegalConsentRequestBuilder() {
    LegalConsentRequest._defaults(this);
  }

  LegalConsentRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _acceptedLegalVersion = $v.acceptedLegalVersion;
      _ageConfirmed = $v.ageConfirmed;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(LegalConsentRequest other) {
    _$v = other as _$LegalConsentRequest;
  }

  @override
  void update(void Function(LegalConsentRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  LegalConsentRequest build() => _build();

  _$LegalConsentRequest _build() {
    final _$result =
        _$v ??
        _$LegalConsentRequest._(
          acceptedLegalVersion: BuiltValueNullFieldError.checkNotNull(
            acceptedLegalVersion,
            r'LegalConsentRequest',
            'acceptedLegalVersion',
          ),
          ageConfirmed: BuiltValueNullFieldError.checkNotNull(ageConfirmed, r'LegalConsentRequest', 'ageConfirmed'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
