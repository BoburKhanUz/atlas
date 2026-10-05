// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_save_response_outfit_items_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSaveResponseOutfitItemsInner extends OutfitSaveResponseOutfitItemsInner {
  @override
  final String id;
  @override
  final String? role;
  @override
  final String wardrobeItemId;

  factory _$OutfitSaveResponseOutfitItemsInner([void Function(OutfitSaveResponseOutfitItemsInnerBuilder)? updates]) =>
      (OutfitSaveResponseOutfitItemsInnerBuilder()..update(updates))._build();

  _$OutfitSaveResponseOutfitItemsInner._({required this.id, this.role, required this.wardrobeItemId}) : super._();
  @override
  OutfitSaveResponseOutfitItemsInner rebuild(void Function(OutfitSaveResponseOutfitItemsInnerBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitSaveResponseOutfitItemsInnerBuilder toBuilder() => OutfitSaveResponseOutfitItemsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSaveResponseOutfitItemsInner &&
        id == other.id &&
        role == other.role &&
        wardrobeItemId == other.wardrobeItemId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, role.hashCode);
    _$hash = $jc(_$hash, wardrobeItemId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSaveResponseOutfitItemsInner')
          ..add('id', id)
          ..add('role', role)
          ..add('wardrobeItemId', wardrobeItemId))
        .toString();
  }
}

class OutfitSaveResponseOutfitItemsInnerBuilder
    implements Builder<OutfitSaveResponseOutfitItemsInner, OutfitSaveResponseOutfitItemsInnerBuilder> {
  _$OutfitSaveResponseOutfitItemsInner? _$v;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _role;
  String? get role => _$this._role;
  set role(String? role) => _$this._role = role;

  String? _wardrobeItemId;
  String? get wardrobeItemId => _$this._wardrobeItemId;
  set wardrobeItemId(String? wardrobeItemId) => _$this._wardrobeItemId = wardrobeItemId;

  OutfitSaveResponseOutfitItemsInnerBuilder() {
    OutfitSaveResponseOutfitItemsInner._defaults(this);
  }

  OutfitSaveResponseOutfitItemsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _role = $v.role;
      _wardrobeItemId = $v.wardrobeItemId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSaveResponseOutfitItemsInner other) {
    _$v = other as _$OutfitSaveResponseOutfitItemsInner;
  }

  @override
  void update(void Function(OutfitSaveResponseOutfitItemsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSaveResponseOutfitItemsInner build() => _build();

  _$OutfitSaveResponseOutfitItemsInner _build() {
    final _$result =
        _$v ??
        _$OutfitSaveResponseOutfitItemsInner._(
          id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitSaveResponseOutfitItemsInner', 'id'),
          role: role,
          wardrobeItemId: BuiltValueNullFieldError.checkNotNull(
            wardrobeItemId,
            r'OutfitSaveResponseOutfitItemsInner',
            'wardrobeItemId',
          ),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
