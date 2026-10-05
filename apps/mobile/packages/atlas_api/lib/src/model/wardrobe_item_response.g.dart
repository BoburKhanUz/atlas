// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_item_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WardrobeItemResponse extends WardrobeItemResponse {
  @override
  final WardrobeItem item;

  factory _$WardrobeItemResponse([void Function(WardrobeItemResponseBuilder)? updates]) =>
      (WardrobeItemResponseBuilder()..update(updates))._build();

  _$WardrobeItemResponse._({required this.item}) : super._();
  @override
  WardrobeItemResponse rebuild(void Function(WardrobeItemResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  WardrobeItemResponseBuilder toBuilder() => WardrobeItemResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobeItemResponse && item == other.item;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, item.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobeItemResponse')..add('item', item)).toString();
  }
}

class WardrobeItemResponseBuilder implements Builder<WardrobeItemResponse, WardrobeItemResponseBuilder> {
  _$WardrobeItemResponse? _$v;

  WardrobeItemBuilder? _item;
  WardrobeItemBuilder get item => _$this._item ??= WardrobeItemBuilder();
  set item(WardrobeItemBuilder? item) => _$this._item = item;

  WardrobeItemResponseBuilder() {
    WardrobeItemResponse._defaults(this);
  }

  WardrobeItemResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _item = $v.item.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobeItemResponse other) {
    _$v = other as _$WardrobeItemResponse;
  }

  @override
  void update(void Function(WardrobeItemResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobeItemResponse build() => _build();

  _$WardrobeItemResponse _build() {
    _$WardrobeItemResponse _$result;
    try {
      _$result = _$v ?? _$WardrobeItemResponse._(item: item.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'item';
        item.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WardrobeItemResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
