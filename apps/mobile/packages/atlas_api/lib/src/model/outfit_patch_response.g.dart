// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_patch_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitPatchResponse extends OutfitPatchResponse {
  @override
  final OutfitRow outfit;

  factory _$OutfitPatchResponse([void Function(OutfitPatchResponseBuilder)? updates]) =>
      (OutfitPatchResponseBuilder()..update(updates))._build();

  _$OutfitPatchResponse._({required this.outfit}) : super._();
  @override
  OutfitPatchResponse rebuild(void Function(OutfitPatchResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitPatchResponseBuilder toBuilder() => OutfitPatchResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitPatchResponse && outfit == other.outfit;
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
    return (newBuiltValueToStringHelper(r'OutfitPatchResponse')..add('outfit', outfit)).toString();
  }
}

class OutfitPatchResponseBuilder implements Builder<OutfitPatchResponse, OutfitPatchResponseBuilder> {
  _$OutfitPatchResponse? _$v;

  OutfitRowBuilder? _outfit;
  OutfitRowBuilder get outfit => _$this._outfit ??= OutfitRowBuilder();
  set outfit(OutfitRowBuilder? outfit) => _$this._outfit = outfit;

  OutfitPatchResponseBuilder() {
    OutfitPatchResponse._defaults(this);
  }

  OutfitPatchResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _outfit = $v.outfit.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitPatchResponse other) {
    _$v = other as _$OutfitPatchResponse;
  }

  @override
  void update(void Function(OutfitPatchResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitPatchResponse build() => _build();

  _$OutfitPatchResponse _build() {
    _$OutfitPatchResponse _$result;
    try {
      _$result = _$v ?? _$OutfitPatchResponse._(outfit: outfit.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'outfit';
        outfit.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitPatchResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
