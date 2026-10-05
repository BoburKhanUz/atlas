// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_save_response_outfit.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSaveResponseOutfit extends OutfitSaveResponseOutfit {
  @override
  final DateTime createdAt;
  @override
  final String? explanation;
  @override
  final String id;
  @override
  final bool isSaved;
  @override
  final BuiltList<OutfitSaveResponseOutfitItemsInner> items;
  @override
  final String? name;
  @override
  final String? occasion;
  @override
  final int? score;
  @override
  final DateTime updatedAt;

  factory _$OutfitSaveResponseOutfit([void Function(OutfitSaveResponseOutfitBuilder)? updates]) =>
      (OutfitSaveResponseOutfitBuilder()..update(updates))._build();

  _$OutfitSaveResponseOutfit._({
    required this.createdAt,
    this.explanation,
    required this.id,
    required this.isSaved,
    required this.items,
    this.name,
    this.occasion,
    this.score,
    required this.updatedAt,
  }) : super._();
  @override
  OutfitSaveResponseOutfit rebuild(void Function(OutfitSaveResponseOutfitBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitSaveResponseOutfitBuilder toBuilder() => OutfitSaveResponseOutfitBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSaveResponseOutfit &&
        createdAt == other.createdAt &&
        explanation == other.explanation &&
        id == other.id &&
        isSaved == other.isSaved &&
        items == other.items &&
        name == other.name &&
        occasion == other.occasion &&
        score == other.score &&
        updatedAt == other.updatedAt;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, explanation.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, isSaved.hashCode);
    _$hash = $jc(_$hash, items.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, score.hashCode);
    _$hash = $jc(_$hash, updatedAt.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSaveResponseOutfit')
          ..add('createdAt', createdAt)
          ..add('explanation', explanation)
          ..add('id', id)
          ..add('isSaved', isSaved)
          ..add('items', items)
          ..add('name', name)
          ..add('occasion', occasion)
          ..add('score', score)
          ..add('updatedAt', updatedAt))
        .toString();
  }
}

class OutfitSaveResponseOutfitBuilder implements Builder<OutfitSaveResponseOutfit, OutfitSaveResponseOutfitBuilder> {
  _$OutfitSaveResponseOutfit? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _explanation;
  String? get explanation => _$this._explanation;
  set explanation(String? explanation) => _$this._explanation = explanation;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  bool? _isSaved;
  bool? get isSaved => _$this._isSaved;
  set isSaved(bool? isSaved) => _$this._isSaved = isSaved;

  ListBuilder<OutfitSaveResponseOutfitItemsInner>? _items;
  ListBuilder<OutfitSaveResponseOutfitItemsInner> get items =>
      _$this._items ??= ListBuilder<OutfitSaveResponseOutfitItemsInner>();
  set items(ListBuilder<OutfitSaveResponseOutfitItemsInner>? items) => _$this._items = items;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  String? _occasion;
  String? get occasion => _$this._occasion;
  set occasion(String? occasion) => _$this._occasion = occasion;

  int? _score;
  int? get score => _$this._score;
  set score(int? score) => _$this._score = score;

  DateTime? _updatedAt;
  DateTime? get updatedAt => _$this._updatedAt;
  set updatedAt(DateTime? updatedAt) => _$this._updatedAt = updatedAt;

  OutfitSaveResponseOutfitBuilder() {
    OutfitSaveResponseOutfit._defaults(this);
  }

  OutfitSaveResponseOutfitBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _explanation = $v.explanation;
      _id = $v.id;
      _isSaved = $v.isSaved;
      _items = $v.items.toBuilder();
      _name = $v.name;
      _occasion = $v.occasion;
      _score = $v.score;
      _updatedAt = $v.updatedAt;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSaveResponseOutfit other) {
    _$v = other as _$OutfitSaveResponseOutfit;
  }

  @override
  void update(void Function(OutfitSaveResponseOutfitBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSaveResponseOutfit build() => _build();

  _$OutfitSaveResponseOutfit _build() {
    _$OutfitSaveResponseOutfit _$result;
    try {
      _$result =
          _$v ??
          _$OutfitSaveResponseOutfit._(
            createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'OutfitSaveResponseOutfit', 'createdAt'),
            explanation: explanation,
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitSaveResponseOutfit', 'id'),
            isSaved: BuiltValueNullFieldError.checkNotNull(isSaved, r'OutfitSaveResponseOutfit', 'isSaved'),
            items: items.build(),
            name: name,
            occasion: occasion,
            score: score,
            updatedAt: BuiltValueNullFieldError.checkNotNull(updatedAt, r'OutfitSaveResponseOutfit', 'updatedAt'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'items';
        items.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitSaveResponseOutfit', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
