// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_detail_item_item.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitDetailItemItem extends OutfitDetailItemItem {
  @override
  final String category;
  @override
  final BuiltList<String> colors;
  @override
  final String id;
  @override
  final BuiltList<ImageObject> images;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? material;
  @override
  final BuiltList<String> season;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? style;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? subcategory;

  factory _$OutfitDetailItemItem([void Function(OutfitDetailItemItemBuilder)? updates]) =>
      (OutfitDetailItemItemBuilder()..update(updates))._build();

  _$OutfitDetailItemItem._({
    required this.category,
    required this.colors,
    required this.id,
    required this.images,
    this.material,
    required this.season,
    this.style,
    this.subcategory,
  }) : super._();
  @override
  OutfitDetailItemItem rebuild(void Function(OutfitDetailItemItemBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitDetailItemItemBuilder toBuilder() => OutfitDetailItemItemBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitDetailItemItem &&
        category == other.category &&
        colors == other.colors &&
        id == other.id &&
        images == other.images &&
        material == other.material &&
        season == other.season &&
        style == other.style &&
        subcategory == other.subcategory;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, category.hashCode);
    _$hash = $jc(_$hash, colors.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, images.hashCode);
    _$hash = $jc(_$hash, material.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, style.hashCode);
    _$hash = $jc(_$hash, subcategory.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitDetailItemItem')
          ..add('category', category)
          ..add('colors', colors)
          ..add('id', id)
          ..add('images', images)
          ..add('material', material)
          ..add('season', season)
          ..add('style', style)
          ..add('subcategory', subcategory))
        .toString();
  }
}

class OutfitDetailItemItemBuilder implements Builder<OutfitDetailItemItem, OutfitDetailItemItemBuilder> {
  _$OutfitDetailItemItem? _$v;

  String? _category;
  String? get category => _$this._category;
  set category(String? category) => _$this._category = category;

  ListBuilder<String>? _colors;
  ListBuilder<String> get colors => _$this._colors ??= ListBuilder<String>();
  set colors(ListBuilder<String>? colors) => _$this._colors = colors;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ListBuilder<ImageObject>? _images;
  ListBuilder<ImageObject> get images => _$this._images ??= ListBuilder<ImageObject>();
  set images(ListBuilder<ImageObject>? images) => _$this._images = images;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _material;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get material =>
      _$this._material ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set material(ColorAnalysisResponseColorProfileContrastLevelBuilder? material) => _$this._material = material;

  ListBuilder<String>? _season;
  ListBuilder<String> get season => _$this._season ??= ListBuilder<String>();
  set season(ListBuilder<String>? season) => _$this._season = season;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _style;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get style =>
      _$this._style ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set style(ColorAnalysisResponseColorProfileContrastLevelBuilder? style) => _$this._style = style;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _subcategory;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get subcategory =>
      _$this._subcategory ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set subcategory(ColorAnalysisResponseColorProfileContrastLevelBuilder? subcategory) =>
      _$this._subcategory = subcategory;

  OutfitDetailItemItemBuilder() {
    OutfitDetailItemItem._defaults(this);
  }

  OutfitDetailItemItemBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _colors = $v.colors.toBuilder();
      _id = $v.id;
      _images = $v.images.toBuilder();
      _material = $v.material?.toBuilder();
      _season = $v.season.toBuilder();
      _style = $v.style?.toBuilder();
      _subcategory = $v.subcategory?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitDetailItemItem other) {
    _$v = other as _$OutfitDetailItemItem;
  }

  @override
  void update(void Function(OutfitDetailItemItemBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitDetailItemItem build() => _build();

  _$OutfitDetailItemItem _build() {
    _$OutfitDetailItemItem _$result;
    try {
      _$result =
          _$v ??
          _$OutfitDetailItemItem._(
            category: BuiltValueNullFieldError.checkNotNull(category, r'OutfitDetailItemItem', 'category'),
            colors: colors.build(),
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitDetailItemItem', 'id'),
            images: images.build(),
            material: _material?.build(),
            season: season.build(),
            style: _style?.build(),
            subcategory: _subcategory?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colors';
        colors.build();

        _$failedField = 'images';
        images.build();
        _$failedField = 'material';
        _material?.build();
        _$failedField = 'season';
        season.build();
        _$failedField = 'style';
        _style?.build();
        _$failedField = 'subcategory';
        _subcategory?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitDetailItemItem', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
