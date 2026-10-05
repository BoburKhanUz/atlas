// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_response_outfits_inner_items_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitGenerateResponseOutfitsInnerItemsInner extends OutfitGenerateResponseOutfitsInnerItemsInner {
  @override
  final String category;
  @override
  final BuiltList<String> colors;
  @override
  final String id;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? imageUrl;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? material;
  @override
  final String role;
  @override
  final BuiltList<String> season;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? style;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? subcategory;

  factory _$OutfitGenerateResponseOutfitsInnerItemsInner([
    void Function(OutfitGenerateResponseOutfitsInnerItemsInnerBuilder)? updates,
  ]) => (OutfitGenerateResponseOutfitsInnerItemsInnerBuilder()..update(updates))._build();

  _$OutfitGenerateResponseOutfitsInnerItemsInner._({
    required this.category,
    required this.colors,
    required this.id,
    this.imageUrl,
    this.material,
    required this.role,
    required this.season,
    this.style,
    this.subcategory,
  }) : super._();
  @override
  OutfitGenerateResponseOutfitsInnerItemsInner rebuild(
    void Function(OutfitGenerateResponseOutfitsInnerItemsInnerBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  OutfitGenerateResponseOutfitsInnerItemsInnerBuilder toBuilder() =>
      OutfitGenerateResponseOutfitsInnerItemsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitGenerateResponseOutfitsInnerItemsInner &&
        category == other.category &&
        colors == other.colors &&
        id == other.id &&
        imageUrl == other.imageUrl &&
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
    _$hash = $jc(_$hash, imageUrl.hashCode);
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
    return (newBuiltValueToStringHelper(r'OutfitGenerateResponseOutfitsInnerItemsInner')
          ..add('category', category)
          ..add('colors', colors)
          ..add('id', id)
          ..add('imageUrl', imageUrl)
          ..add('material', material)
          ..add('role', role)
          ..add('season', season)
          ..add('style', style)
          ..add('subcategory', subcategory))
        .toString();
  }
}

class OutfitGenerateResponseOutfitsInnerItemsInnerBuilder
    implements
        Builder<OutfitGenerateResponseOutfitsInnerItemsInner, OutfitGenerateResponseOutfitsInnerItemsInnerBuilder> {
  _$OutfitGenerateResponseOutfitsInnerItemsInner? _$v;

  String? _category;
  String? get category => _$this._category;
  set category(String? category) => _$this._category = category;

  ListBuilder<String>? _colors;
  ListBuilder<String> get colors => _$this._colors ??= ListBuilder<String>();
  set colors(ListBuilder<String>? colors) => _$this._colors = colors;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _imageUrl;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get imageUrl =>
      _$this._imageUrl ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set imageUrl(ColorAnalysisResponseColorProfileContrastLevelBuilder? imageUrl) => _$this._imageUrl = imageUrl;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _material;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get material =>
      _$this._material ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set material(ColorAnalysisResponseColorProfileContrastLevelBuilder? material) => _$this._material = material;

  String? _role;
  String? get role => _$this._role;
  set role(String? role) => _$this._role = role;

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

  OutfitGenerateResponseOutfitsInnerItemsInnerBuilder() {
    OutfitGenerateResponseOutfitsInnerItemsInner._defaults(this);
  }

  OutfitGenerateResponseOutfitsInnerItemsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _colors = $v.colors.toBuilder();
      _id = $v.id;
      _imageUrl = $v.imageUrl?.toBuilder();
      _material = $v.material?.toBuilder();
      _role = $v.role;
      _season = $v.season.toBuilder();
      _style = $v.style?.toBuilder();
      _subcategory = $v.subcategory?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitGenerateResponseOutfitsInnerItemsInner other) {
    _$v = other as _$OutfitGenerateResponseOutfitsInnerItemsInner;
  }

  @override
  void update(void Function(OutfitGenerateResponseOutfitsInnerItemsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitGenerateResponseOutfitsInnerItemsInner build() => _build();

  _$OutfitGenerateResponseOutfitsInnerItemsInner _build() {
    _$OutfitGenerateResponseOutfitsInnerItemsInner _$result;
    try {
      _$result =
          _$v ??
          _$OutfitGenerateResponseOutfitsInnerItemsInner._(
            category: BuiltValueNullFieldError.checkNotNull(
              category,
              r'OutfitGenerateResponseOutfitsInnerItemsInner',
              'category',
            ),
            colors: colors.build(),
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitGenerateResponseOutfitsInnerItemsInner', 'id'),
            imageUrl: _imageUrl?.build(),
            material: _material?.build(),
            role: BuiltValueNullFieldError.checkNotNull(role, r'OutfitGenerateResponseOutfitsInnerItemsInner', 'role'),
            season: season.build(),
            style: _style?.build(),
            subcategory: _subcategory?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colors';
        colors.build();

        _$failedField = 'imageUrl';
        _imageUrl?.build();
        _$failedField = 'material';
        _material?.build();

        _$failedField = 'season';
        season.build();
        _$failedField = 'style';
        _style?.build();
        _$failedField = 'subcategory';
        _subcategory?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitGenerateResponseOutfitsInnerItemsInner', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
