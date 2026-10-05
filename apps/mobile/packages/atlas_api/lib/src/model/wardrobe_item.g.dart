// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_item.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WardrobeItem extends WardrobeItem {
  @override
  final String category;
  @override
  final BuiltList<String> colors;
  @override
  final BuiltMap<String, num> confidences;
  @override
  final BuiltList<CorrectionLogEntry> correctionLog;
  @override
  final DateTime createdAt;
  @override
  final String? fit;
  @override
  final String? formality;
  @override
  final String? gender;
  @override
  final String id;
  @override
  final BuiltList<ImageObject> images;
  @override
  final String? material;
  @override
  final String? pattern;
  @override
  final ImageObject? primaryImage;
  @override
  final BuiltList<String> season;
  @override
  final String? sleeveLength;
  @override
  final String? style;
  @override
  final String? subcategory;
  @override
  final DateTime updatedAt;
  @override
  final bool wasCorrected;

  factory _$WardrobeItem([void Function(WardrobeItemBuilder)? updates]) =>
      (WardrobeItemBuilder()..update(updates))._build();

  _$WardrobeItem._({
    required this.category,
    required this.colors,
    required this.confidences,
    required this.correctionLog,
    required this.createdAt,
    this.fit,
    this.formality,
    this.gender,
    required this.id,
    required this.images,
    this.material,
    this.pattern,
    this.primaryImage,
    required this.season,
    this.sleeveLength,
    this.style,
    this.subcategory,
    required this.updatedAt,
    required this.wasCorrected,
  }) : super._();
  @override
  WardrobeItem rebuild(void Function(WardrobeItemBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  WardrobeItemBuilder toBuilder() => WardrobeItemBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobeItem &&
        category == other.category &&
        colors == other.colors &&
        confidences == other.confidences &&
        correctionLog == other.correctionLog &&
        createdAt == other.createdAt &&
        fit == other.fit &&
        formality == other.formality &&
        gender == other.gender &&
        id == other.id &&
        images == other.images &&
        material == other.material &&
        pattern == other.pattern &&
        primaryImage == other.primaryImage &&
        season == other.season &&
        sleeveLength == other.sleeveLength &&
        style == other.style &&
        subcategory == other.subcategory &&
        updatedAt == other.updatedAt &&
        wasCorrected == other.wasCorrected;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, category.hashCode);
    _$hash = $jc(_$hash, colors.hashCode);
    _$hash = $jc(_$hash, confidences.hashCode);
    _$hash = $jc(_$hash, correctionLog.hashCode);
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, fit.hashCode);
    _$hash = $jc(_$hash, formality.hashCode);
    _$hash = $jc(_$hash, gender.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, images.hashCode);
    _$hash = $jc(_$hash, material.hashCode);
    _$hash = $jc(_$hash, pattern.hashCode);
    _$hash = $jc(_$hash, primaryImage.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, sleeveLength.hashCode);
    _$hash = $jc(_$hash, style.hashCode);
    _$hash = $jc(_$hash, subcategory.hashCode);
    _$hash = $jc(_$hash, updatedAt.hashCode);
    _$hash = $jc(_$hash, wasCorrected.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobeItem')
          ..add('category', category)
          ..add('colors', colors)
          ..add('confidences', confidences)
          ..add('correctionLog', correctionLog)
          ..add('createdAt', createdAt)
          ..add('fit', fit)
          ..add('formality', formality)
          ..add('gender', gender)
          ..add('id', id)
          ..add('images', images)
          ..add('material', material)
          ..add('pattern', pattern)
          ..add('primaryImage', primaryImage)
          ..add('season', season)
          ..add('sleeveLength', sleeveLength)
          ..add('style', style)
          ..add('subcategory', subcategory)
          ..add('updatedAt', updatedAt)
          ..add('wasCorrected', wasCorrected))
        .toString();
  }
}

class WardrobeItemBuilder implements Builder<WardrobeItem, WardrobeItemBuilder> {
  _$WardrobeItem? _$v;

  String? _category;
  String? get category => _$this._category;
  set category(String? category) => _$this._category = category;

  ListBuilder<String>? _colors;
  ListBuilder<String> get colors => _$this._colors ??= ListBuilder<String>();
  set colors(ListBuilder<String>? colors) => _$this._colors = colors;

  MapBuilder<String, num>? _confidences;
  MapBuilder<String, num> get confidences => _$this._confidences ??= MapBuilder<String, num>();
  set confidences(MapBuilder<String, num>? confidences) => _$this._confidences = confidences;

  ListBuilder<CorrectionLogEntry>? _correctionLog;
  ListBuilder<CorrectionLogEntry> get correctionLog => _$this._correctionLog ??= ListBuilder<CorrectionLogEntry>();
  set correctionLog(ListBuilder<CorrectionLogEntry>? correctionLog) => _$this._correctionLog = correctionLog;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _fit;
  String? get fit => _$this._fit;
  set fit(String? fit) => _$this._fit = fit;

  String? _formality;
  String? get formality => _$this._formality;
  set formality(String? formality) => _$this._formality = formality;

  String? _gender;
  String? get gender => _$this._gender;
  set gender(String? gender) => _$this._gender = gender;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ListBuilder<ImageObject>? _images;
  ListBuilder<ImageObject> get images => _$this._images ??= ListBuilder<ImageObject>();
  set images(ListBuilder<ImageObject>? images) => _$this._images = images;

  String? _material;
  String? get material => _$this._material;
  set material(String? material) => _$this._material = material;

  String? _pattern;
  String? get pattern => _$this._pattern;
  set pattern(String? pattern) => _$this._pattern = pattern;

  ImageObjectBuilder? _primaryImage;
  ImageObjectBuilder get primaryImage => _$this._primaryImage ??= ImageObjectBuilder();
  set primaryImage(ImageObjectBuilder? primaryImage) => _$this._primaryImage = primaryImage;

  ListBuilder<String>? _season;
  ListBuilder<String> get season => _$this._season ??= ListBuilder<String>();
  set season(ListBuilder<String>? season) => _$this._season = season;

  String? _sleeveLength;
  String? get sleeveLength => _$this._sleeveLength;
  set sleeveLength(String? sleeveLength) => _$this._sleeveLength = sleeveLength;

  String? _style;
  String? get style => _$this._style;
  set style(String? style) => _$this._style = style;

  String? _subcategory;
  String? get subcategory => _$this._subcategory;
  set subcategory(String? subcategory) => _$this._subcategory = subcategory;

  DateTime? _updatedAt;
  DateTime? get updatedAt => _$this._updatedAt;
  set updatedAt(DateTime? updatedAt) => _$this._updatedAt = updatedAt;

  bool? _wasCorrected;
  bool? get wasCorrected => _$this._wasCorrected;
  set wasCorrected(bool? wasCorrected) => _$this._wasCorrected = wasCorrected;

  WardrobeItemBuilder() {
    WardrobeItem._defaults(this);
  }

  WardrobeItemBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _colors = $v.colors.toBuilder();
      _confidences = $v.confidences.toBuilder();
      _correctionLog = $v.correctionLog.toBuilder();
      _createdAt = $v.createdAt;
      _fit = $v.fit;
      _formality = $v.formality;
      _gender = $v.gender;
      _id = $v.id;
      _images = $v.images.toBuilder();
      _material = $v.material;
      _pattern = $v.pattern;
      _primaryImage = $v.primaryImage?.toBuilder();
      _season = $v.season.toBuilder();
      _sleeveLength = $v.sleeveLength;
      _style = $v.style;
      _subcategory = $v.subcategory;
      _updatedAt = $v.updatedAt;
      _wasCorrected = $v.wasCorrected;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobeItem other) {
    _$v = other as _$WardrobeItem;
  }

  @override
  void update(void Function(WardrobeItemBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobeItem build() => _build();

  _$WardrobeItem _build() {
    _$WardrobeItem _$result;
    try {
      _$result =
          _$v ??
          _$WardrobeItem._(
            category: BuiltValueNullFieldError.checkNotNull(category, r'WardrobeItem', 'category'),
            colors: colors.build(),
            confidences: confidences.build(),
            correctionLog: correctionLog.build(),
            createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'WardrobeItem', 'createdAt'),
            fit: fit,
            formality: formality,
            gender: gender,
            id: BuiltValueNullFieldError.checkNotNull(id, r'WardrobeItem', 'id'),
            images: images.build(),
            material: material,
            pattern: pattern,
            primaryImage: _primaryImage?.build(),
            season: season.build(),
            sleeveLength: sleeveLength,
            style: style,
            subcategory: subcategory,
            updatedAt: BuiltValueNullFieldError.checkNotNull(updatedAt, r'WardrobeItem', 'updatedAt'),
            wasCorrected: BuiltValueNullFieldError.checkNotNull(wasCorrected, r'WardrobeItem', 'wasCorrected'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colors';
        colors.build();
        _$failedField = 'confidences';
        confidences.build();
        _$failedField = 'correctionLog';
        correctionLog.build();

        _$failedField = 'images';
        images.build();

        _$failedField = 'primaryImage';
        _primaryImage?.build();
        _$failedField = 'season';
        season.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WardrobeItem', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
