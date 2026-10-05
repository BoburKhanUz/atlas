// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_save_request_items_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSaveRequestItemsInner extends OutfitSaveRequestItemsInner {
  @override
  final String itemId;
  @override
  final String role;

  factory _$OutfitSaveRequestItemsInner([void Function(OutfitSaveRequestItemsInnerBuilder)? updates]) =>
      (OutfitSaveRequestItemsInnerBuilder()..update(updates))._build();

  _$OutfitSaveRequestItemsInner._({required this.itemId, required this.role}) : super._();
  @override
  OutfitSaveRequestItemsInner rebuild(void Function(OutfitSaveRequestItemsInnerBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitSaveRequestItemsInnerBuilder toBuilder() => OutfitSaveRequestItemsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSaveRequestItemsInner && itemId == other.itemId && role == other.role;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, itemId.hashCode);
    _$hash = $jc(_$hash, role.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSaveRequestItemsInner')
          ..add('itemId', itemId)
          ..add('role', role))
        .toString();
  }
}

class OutfitSaveRequestItemsInnerBuilder
    implements Builder<OutfitSaveRequestItemsInner, OutfitSaveRequestItemsInnerBuilder> {
  _$OutfitSaveRequestItemsInner? _$v;

  String? _itemId;
  String? get itemId => _$this._itemId;
  set itemId(String? itemId) => _$this._itemId = itemId;

  String? _role;
  String? get role => _$this._role;
  set role(String? role) => _$this._role = role;

  OutfitSaveRequestItemsInnerBuilder() {
    OutfitSaveRequestItemsInner._defaults(this);
  }

  OutfitSaveRequestItemsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _itemId = $v.itemId;
      _role = $v.role;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSaveRequestItemsInner other) {
    _$v = other as _$OutfitSaveRequestItemsInner;
  }

  @override
  void update(void Function(OutfitSaveRequestItemsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSaveRequestItemsInner build() => _build();

  _$OutfitSaveRequestItemsInner _build() {
    final _$result =
        _$v ??
        _$OutfitSaveRequestItemsInner._(
          itemId: BuiltValueNullFieldError.checkNotNull(itemId, r'OutfitSaveRequestItemsInner', 'itemId'),
          role: BuiltValueNullFieldError.checkNotNull(role, r'OutfitSaveRequestItemsInner', 'role'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
