// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_list_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitListResponse extends OutfitListResponse {
  @override
  final BuiltList<OutfitSummary> outfits;

  factory _$OutfitListResponse([void Function(OutfitListResponseBuilder)? updates]) =>
      (OutfitListResponseBuilder()..update(updates))._build();

  _$OutfitListResponse._({required this.outfits}) : super._();
  @override
  OutfitListResponse rebuild(void Function(OutfitListResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitListResponseBuilder toBuilder() => OutfitListResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitListResponse && outfits == other.outfits;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, outfits.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitListResponse')..add('outfits', outfits)).toString();
  }
}

class OutfitListResponseBuilder implements Builder<OutfitListResponse, OutfitListResponseBuilder> {
  _$OutfitListResponse? _$v;

  ListBuilder<OutfitSummary>? _outfits;
  ListBuilder<OutfitSummary> get outfits => _$this._outfits ??= ListBuilder<OutfitSummary>();
  set outfits(ListBuilder<OutfitSummary>? outfits) => _$this._outfits = outfits;

  OutfitListResponseBuilder() {
    OutfitListResponse._defaults(this);
  }

  OutfitListResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _outfits = $v.outfits.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitListResponse other) {
    _$v = other as _$OutfitListResponse;
  }

  @override
  void update(void Function(OutfitListResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitListResponse build() => _build();

  _$OutfitListResponse _build() {
    _$OutfitListResponse _$result;
    try {
      _$result = _$v ?? _$OutfitListResponse._(outfits: outfits.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'outfits';
        outfits.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitListResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
