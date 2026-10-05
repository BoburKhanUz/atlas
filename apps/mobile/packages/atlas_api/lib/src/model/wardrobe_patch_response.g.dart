// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_patch_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WardrobePatchResponse extends WardrobePatchResponse {
  @override
  final BuiltList<CorrectionLogEntry> corrections;
  @override
  final WardrobeItem item;

  factory _$WardrobePatchResponse([void Function(WardrobePatchResponseBuilder)? updates]) =>
      (WardrobePatchResponseBuilder()..update(updates))._build();

  _$WardrobePatchResponse._({required this.corrections, required this.item}) : super._();
  @override
  WardrobePatchResponse rebuild(void Function(WardrobePatchResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  WardrobePatchResponseBuilder toBuilder() => WardrobePatchResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobePatchResponse && corrections == other.corrections && item == other.item;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, corrections.hashCode);
    _$hash = $jc(_$hash, item.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobePatchResponse')
          ..add('corrections', corrections)
          ..add('item', item))
        .toString();
  }
}

class WardrobePatchResponseBuilder implements Builder<WardrobePatchResponse, WardrobePatchResponseBuilder> {
  _$WardrobePatchResponse? _$v;

  ListBuilder<CorrectionLogEntry>? _corrections;
  ListBuilder<CorrectionLogEntry> get corrections => _$this._corrections ??= ListBuilder<CorrectionLogEntry>();
  set corrections(ListBuilder<CorrectionLogEntry>? corrections) => _$this._corrections = corrections;

  WardrobeItemBuilder? _item;
  WardrobeItemBuilder get item => _$this._item ??= WardrobeItemBuilder();
  set item(WardrobeItemBuilder? item) => _$this._item = item;

  WardrobePatchResponseBuilder() {
    WardrobePatchResponse._defaults(this);
  }

  WardrobePatchResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _corrections = $v.corrections.toBuilder();
      _item = $v.item.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobePatchResponse other) {
    _$v = other as _$WardrobePatchResponse;
  }

  @override
  void update(void Function(WardrobePatchResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobePatchResponse build() => _build();

  _$WardrobePatchResponse _build() {
    _$WardrobePatchResponse _$result;
    try {
      _$result = _$v ?? _$WardrobePatchResponse._(corrections: corrections.build(), item: item.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'corrections';
        corrections.build();
        _$failedField = 'item';
        item.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WardrobePatchResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
