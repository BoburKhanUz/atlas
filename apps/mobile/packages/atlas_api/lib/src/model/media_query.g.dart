// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_query.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$MediaQuery extends MediaQuery {
  @override
  final String exp;
  @override
  final String sig;

  factory _$MediaQuery([void Function(MediaQueryBuilder)? updates]) => (MediaQueryBuilder()..update(updates))._build();

  _$MediaQuery._({required this.exp, required this.sig}) : super._();
  @override
  MediaQuery rebuild(void Function(MediaQueryBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  MediaQueryBuilder toBuilder() => MediaQueryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is MediaQuery && exp == other.exp && sig == other.sig;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, exp.hashCode);
    _$hash = $jc(_$hash, sig.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'MediaQuery')
          ..add('exp', exp)
          ..add('sig', sig))
        .toString();
  }
}

class MediaQueryBuilder implements Builder<MediaQuery, MediaQueryBuilder> {
  _$MediaQuery? _$v;

  String? _exp;
  String? get exp => _$this._exp;
  set exp(String? exp) => _$this._exp = exp;

  String? _sig;
  String? get sig => _$this._sig;
  set sig(String? sig) => _$this._sig = sig;

  MediaQueryBuilder() {
    MediaQuery._defaults(this);
  }

  MediaQueryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _exp = $v.exp;
      _sig = $v.sig;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(MediaQuery other) {
    _$v = other as _$MediaQuery;
  }

  @override
  void update(void Function(MediaQueryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  MediaQuery build() => _build();

  _$MediaQuery _build() {
    final _$result =
        _$v ??
        _$MediaQuery._(
          exp: BuiltValueNullFieldError.checkNotNull(exp, r'MediaQuery', 'exp'),
          sig: BuiltValueNullFieldError.checkNotNull(sig, r'MediaQuery', 'sig'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
