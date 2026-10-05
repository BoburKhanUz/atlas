// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_list_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WardrobeListResponse extends WardrobeListResponse {
  @override
  final BuiltList<WardrobeItem> items;
  @override
  final String? nextCursor;

  factory _$WardrobeListResponse([void Function(WardrobeListResponseBuilder)? updates]) =>
      (WardrobeListResponseBuilder()..update(updates))._build();

  _$WardrobeListResponse._({required this.items, this.nextCursor}) : super._();
  @override
  WardrobeListResponse rebuild(void Function(WardrobeListResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  WardrobeListResponseBuilder toBuilder() => WardrobeListResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobeListResponse && items == other.items && nextCursor == other.nextCursor;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, items.hashCode);
    _$hash = $jc(_$hash, nextCursor.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobeListResponse')
          ..add('items', items)
          ..add('nextCursor', nextCursor))
        .toString();
  }
}

class WardrobeListResponseBuilder implements Builder<WardrobeListResponse, WardrobeListResponseBuilder> {
  _$WardrobeListResponse? _$v;

  ListBuilder<WardrobeItem>? _items;
  ListBuilder<WardrobeItem> get items => _$this._items ??= ListBuilder<WardrobeItem>();
  set items(ListBuilder<WardrobeItem>? items) => _$this._items = items;

  String? _nextCursor;
  String? get nextCursor => _$this._nextCursor;
  set nextCursor(String? nextCursor) => _$this._nextCursor = nextCursor;

  WardrobeListResponseBuilder() {
    WardrobeListResponse._defaults(this);
  }

  WardrobeListResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _items = $v.items.toBuilder();
      _nextCursor = $v.nextCursor;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobeListResponse other) {
    _$v = other as _$WardrobeListResponse;
  }

  @override
  void update(void Function(WardrobeListResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobeListResponse build() => _build();

  _$WardrobeListResponse _build() {
    _$WardrobeListResponse _$result;
    try {
      _$result = _$v ?? _$WardrobeListResponse._(items: items.build(), nextCursor: nextCursor);
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'items';
        items.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WardrobeListResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
