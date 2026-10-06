// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_generate_response_outfits_inner_items_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_top =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('top');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_bottom =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('bottom');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_dress =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('dress');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_outerwear =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('outerwear');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_footwear =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('footwear');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_accessory =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('accessory');
const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_unknownDefaultOpenApi =
    const OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum._('unknownDefaultOpenApi');

OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnumValueOf(String name) {
  switch (name) {
    case 'top':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_top;
    case 'bottom':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_bottom;
    case 'dress':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_dress;
    case 'outerwear':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_outerwear;
    case 'footwear':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_footwear;
    case 'accessory':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_accessory;
    case 'unknownDefaultOpenApi':
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_unknownDefaultOpenApi;
    default:
      return _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum>
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnumValues =
    BuiltSet<OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum>(
      const <OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum>[
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_top,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_bottom,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_dress,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_outerwear,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_footwear,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_accessory,
        _$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum_unknownDefaultOpenApi,
      ],
    );

Serializer<OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum>
_$outfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnumSerializer =
    _$OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnumSerializer();

class _$OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnumSerializer
    implements PrimitiveSerializer<OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'top': 'top',
    'bottom': 'bottom',
    'dress': 'dress',
    'outerwear': 'outerwear',
    'footwear': 'footwear',
    'accessory': 'accessory',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'top': 'top',
    'bottom': 'bottom',
    'dress': 'dress',
    'outerwear': 'outerwear',
    'footwear': 'footwear',
    'accessory': 'accessory',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum];
  @override
  final String wireName = 'OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum.valueOf(
    _fromWire[serialized] ?? (serialized is String ? serialized : ''),
  );
}

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
  final OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum layeringRole;
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
    required this.layeringRole,
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
        layeringRole == other.layeringRole &&
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
    _$hash = $jc(_$hash, layeringRole.hashCode);
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
          ..add('layeringRole', layeringRole)
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

  OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum? _layeringRole;
  OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum? get layeringRole => _$this._layeringRole;
  set layeringRole(OutfitGenerateResponseOutfitsInnerItemsInnerLayeringRoleEnum? layeringRole) =>
      _$this._layeringRole = layeringRole;

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
      _layeringRole = $v.layeringRole;
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
            layeringRole: BuiltValueNullFieldError.checkNotNull(
              layeringRole,
              r'OutfitGenerateResponseOutfitsInnerItemsInner',
              'layeringRole',
            ),
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
