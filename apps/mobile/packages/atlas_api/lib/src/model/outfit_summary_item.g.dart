// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_summary_item.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSummaryItem extends OutfitSummaryItem {
  @override
  final String category;
  @override
  final BuiltList<String> colors;
  @override
  final String id;
  @override
  final ImageObject? image;
  @override
  final String? material;
  @override
  final String? role;
  @override
  final BuiltList<String> season;
  @override
  final String? style;
  @override
  final String? subcategory;

  factory _$OutfitSummaryItem([void Function(OutfitSummaryItemBuilder)? updates]) =>
      (OutfitSummaryItemBuilder()..update(updates))._build();

  _$OutfitSummaryItem._({
    required this.category,
    required this.colors,
    required this.id,
    this.image,
    this.material,
    this.role,
    required this.season,
    this.style,
    this.subcategory,
  }) : super._();
  @override
  OutfitSummaryItem rebuild(void Function(OutfitSummaryItemBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitSummaryItemBuilder toBuilder() => OutfitSummaryItemBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSummaryItem &&
        category == other.category &&
        colors == other.colors &&
        id == other.id &&
        image == other.image &&
        material == other.material &&
        role == other.role &&
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
    _$hash = $jc(_$hash, image.hashCode);
    _$hash = $jc(_$hash, material.hashCode);
    _$hash = $jc(_$hash, role.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, style.hashCode);
    _$hash = $jc(_$hash, subcategory.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSummaryItem')
          ..add('category', category)
          ..add('colors', colors)
          ..add('id', id)
          ..add('image', image)
          ..add('material', material)
          ..add('role', role)
          ..add('season', season)
          ..add('style', style)
          ..add('subcategory', subcategory))
        .toString();
  }
}

class OutfitSummaryItemBuilder implements Builder<OutfitSummaryItem, OutfitSummaryItemBuilder> {
  _$OutfitSummaryItem? _$v;

  String? _category;
  String? get category => _$this._category;
  set category(String? category) => _$this._category = category;

  ListBuilder<String>? _colors;
  ListBuilder<String> get colors => _$this._colors ??= ListBuilder<String>();
  set colors(ListBuilder<String>? colors) => _$this._colors = colors;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ImageObjectBuilder? _image;
  ImageObjectBuilder get image => _$this._image ??= ImageObjectBuilder();
  set image(ImageObjectBuilder? image) => _$this._image = image;

  String? _material;
  String? get material => _$this._material;
  set material(String? material) => _$this._material = material;

  String? _role;
  String? get role => _$this._role;
  set role(String? role) => _$this._role = role;

  ListBuilder<String>? _season;
  ListBuilder<String> get season => _$this._season ??= ListBuilder<String>();
  set season(ListBuilder<String>? season) => _$this._season = season;

  String? _style;
  String? get style => _$this._style;
  set style(String? style) => _$this._style = style;

  String? _subcategory;
  String? get subcategory => _$this._subcategory;
  set subcategory(String? subcategory) => _$this._subcategory = subcategory;

  OutfitSummaryItemBuilder() {
    OutfitSummaryItem._defaults(this);
  }

  OutfitSummaryItemBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _colors = $v.colors.toBuilder();
      _id = $v.id;
      _image = $v.image?.toBuilder();
      _material = $v.material;
      _role = $v.role;
      _season = $v.season.toBuilder();
      _style = $v.style;
      _subcategory = $v.subcategory;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSummaryItem other) {
    _$v = other as _$OutfitSummaryItem;
  }

  @override
  void update(void Function(OutfitSummaryItemBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSummaryItem build() => _build();

  _$OutfitSummaryItem _build() {
    _$OutfitSummaryItem _$result;
    try {
      _$result =
          _$v ??
          _$OutfitSummaryItem._(
            category: BuiltValueNullFieldError.checkNotNull(category, r'OutfitSummaryItem', 'category'),
            colors: colors.build(),
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitSummaryItem', 'id'),
            image: _image?.build(),
            material: material,
            role: role,
            season: season.build(),
            style: style,
            subcategory: subcategory,
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colors';
        colors.build();

        _$failedField = 'image';
        _image?.build();

        _$failedField = 'season';
        season.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitSummaryItem', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
