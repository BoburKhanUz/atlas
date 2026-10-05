// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_save_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSaveResponse extends OutfitSaveResponse {
  @override
  final OutfitSaveResponseOutfit outfit;

  factory _$OutfitSaveResponse([void Function(OutfitSaveResponseBuilder)? updates]) =>
      (OutfitSaveResponseBuilder()..update(updates))._build();

  _$OutfitSaveResponse._({required this.outfit}) : super._();
  @override
  OutfitSaveResponse rebuild(void Function(OutfitSaveResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitSaveResponseBuilder toBuilder() => OutfitSaveResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSaveResponse && outfit == other.outfit;
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
    return (newBuiltValueToStringHelper(r'OutfitSaveResponse')..add('outfit', outfit)).toString();
  }
}

class OutfitSaveResponseBuilder implements Builder<OutfitSaveResponse, OutfitSaveResponseBuilder> {
  _$OutfitSaveResponse? _$v;

  OutfitSaveResponseOutfitBuilder? _outfit;
  OutfitSaveResponseOutfitBuilder get outfit => _$this._outfit ??= OutfitSaveResponseOutfitBuilder();
  set outfit(OutfitSaveResponseOutfitBuilder? outfit) => _$this._outfit = outfit;

  OutfitSaveResponseBuilder() {
    OutfitSaveResponse._defaults(this);
  }

  OutfitSaveResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _outfit = $v.outfit.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSaveResponse other) {
    _$v = other as _$OutfitSaveResponse;
  }

  @override
  void update(void Function(OutfitSaveResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSaveResponse build() => _build();

  _$OutfitSaveResponse _build() {
    _$OutfitSaveResponse _$result;
    try {
      _$result = _$v ?? _$OutfitSaveResponse._(outfit: outfit.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'outfit';
        outfit.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitSaveResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
