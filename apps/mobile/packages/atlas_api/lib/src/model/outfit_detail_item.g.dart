// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_detail_item.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitDetailItem extends OutfitDetailItem {
  @override
  final String id;
  @override
  final OutfitDetailItemItem item;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? role;
  @override
  final String wardrobeItemId;

  factory _$OutfitDetailItem([void Function(OutfitDetailItemBuilder)? updates]) =>
      (OutfitDetailItemBuilder()..update(updates))._build();

  _$OutfitDetailItem._({required this.id, required this.item, this.role, required this.wardrobeItemId}) : super._();
  @override
  OutfitDetailItem rebuild(void Function(OutfitDetailItemBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitDetailItemBuilder toBuilder() => OutfitDetailItemBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitDetailItem &&
        id == other.id &&
        item == other.item &&
        role == other.role &&
        wardrobeItemId == other.wardrobeItemId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, item.hashCode);
    _$hash = $jc(_$hash, role.hashCode);
    _$hash = $jc(_$hash, wardrobeItemId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitDetailItem')
          ..add('id', id)
          ..add('item', item)
          ..add('role', role)
          ..add('wardrobeItemId', wardrobeItemId))
        .toString();
  }
}

class OutfitDetailItemBuilder implements Builder<OutfitDetailItem, OutfitDetailItemBuilder> {
  _$OutfitDetailItem? _$v;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  OutfitDetailItemItemBuilder? _item;
  OutfitDetailItemItemBuilder get item => _$this._item ??= OutfitDetailItemItemBuilder();
  set item(OutfitDetailItemItemBuilder? item) => _$this._item = item;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _role;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get role =>
      _$this._role ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set role(ColorAnalysisResponseColorProfileContrastLevelBuilder? role) => _$this._role = role;

  String? _wardrobeItemId;
  String? get wardrobeItemId => _$this._wardrobeItemId;
  set wardrobeItemId(String? wardrobeItemId) => _$this._wardrobeItemId = wardrobeItemId;

  OutfitDetailItemBuilder() {
    OutfitDetailItem._defaults(this);
  }

  OutfitDetailItemBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _item = $v.item.toBuilder();
      _role = $v.role?.toBuilder();
      _wardrobeItemId = $v.wardrobeItemId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitDetailItem other) {
    _$v = other as _$OutfitDetailItem;
  }

  @override
  void update(void Function(OutfitDetailItemBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitDetailItem build() => _build();

  _$OutfitDetailItem _build() {
    _$OutfitDetailItem _$result;
    try {
      _$result =
          _$v ??
          _$OutfitDetailItem._(
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitDetailItem', 'id'),
            item: item.build(),
            role: _role?.build(),
            wardrobeItemId: BuiltValueNullFieldError.checkNotNull(
              wardrobeItemId,
              r'OutfitDetailItem',
              'wardrobeItemId',
            ),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'item';
        item.build();
        _$failedField = 'role';
        _role?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitDetailItem', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
