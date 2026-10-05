// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_detail_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitDetailResponse extends OutfitDetailResponse {
  @override
  final OutfitDetail outfit;

  factory _$OutfitDetailResponse([void Function(OutfitDetailResponseBuilder)? updates]) =>
      (OutfitDetailResponseBuilder()..update(updates))._build();

  _$OutfitDetailResponse._({required this.outfit}) : super._();
  @override
  OutfitDetailResponse rebuild(void Function(OutfitDetailResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitDetailResponseBuilder toBuilder() => OutfitDetailResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitDetailResponse && outfit == other.outfit;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, outfit.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitDetailResponse')..add('outfit', outfit)).toString();
  }
}

class OutfitDetailResponseBuilder implements Builder<OutfitDetailResponse, OutfitDetailResponseBuilder> {
  _$OutfitDetailResponse? _$v;

  OutfitDetailBuilder? _outfit;
  OutfitDetailBuilder get outfit => _$this._outfit ??= OutfitDetailBuilder();
  set outfit(OutfitDetailBuilder? outfit) => _$this._outfit = outfit;

  OutfitDetailResponseBuilder() {
    OutfitDetailResponse._defaults(this);
  }

  OutfitDetailResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _outfit = $v.outfit.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitDetailResponse other) {
    _$v = other as _$OutfitDetailResponse;
  }

  @override
  void update(void Function(OutfitDetailResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitDetailResponse build() => _build();

  _$OutfitDetailResponse _build() {
    _$OutfitDetailResponse _$result;
    try {
      _$result = _$v ?? _$OutfitDetailResponse._(outfit: outfit.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'outfit';
        outfit.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitDetailResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
