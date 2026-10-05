// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'detection.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$Detection extends Detection {
  @override
  final String category;
  @override
  final BuiltList<String> colors;
  @override
  final BuiltMap<String, num> confidence;
  @override
  final String? fit;
  @override
  final String? formality;
  @override
  final String? gender;
  @override
  final String? material;
  @override
  final bool mock;
  @override
  final String? pattern;
  @override
  final BuiltList<String> season;
  @override
  final String? sleeveLength;
  @override
  final String? style;
  @override
  final String? subcategory;

  factory _$Detection([void Function(DetectionBuilder)? updates]) => (DetectionBuilder()..update(updates))._build();

  _$Detection._({
    required this.category,
    required this.colors,
    required this.confidence,
    this.fit,
    this.formality,
    this.gender,
    this.material,
    required this.mock,
    this.pattern,
    required this.season,
    this.sleeveLength,
    this.style,
    this.subcategory,
  }) : super._();
  @override
  Detection rebuild(void Function(DetectionBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  DetectionBuilder toBuilder() => DetectionBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is Detection &&
        category == other.category &&
        colors == other.colors &&
        confidence == other.confidence &&
        fit == other.fit &&
        formality == other.formality &&
        gender == other.gender &&
        material == other.material &&
        mock == other.mock &&
        pattern == other.pattern &&
        season == other.season &&
        sleeveLength == other.sleeveLength &&
        style == other.style &&
        subcategory == other.subcategory;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, category.hashCode);
    _$hash = $jc(_$hash, colors.hashCode);
    _$hash = $jc(_$hash, confidence.hashCode);
    _$hash = $jc(_$hash, fit.hashCode);
    _$hash = $jc(_$hash, formality.hashCode);
    _$hash = $jc(_$hash, gender.hashCode);
    _$hash = $jc(_$hash, material.hashCode);
    _$hash = $jc(_$hash, mock.hashCode);
    _$hash = $jc(_$hash, pattern.hashCode);
    _$hash = $jc(_$hash, season.hashCode);
    _$hash = $jc(_$hash, sleeveLength.hashCode);
    _$hash = $jc(_$hash, style.hashCode);
    _$hash = $jc(_$hash, subcategory.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'Detection')
          ..add('category', category)
          ..add('colors', colors)
          ..add('confidence', confidence)
          ..add('fit', fit)
          ..add('formality', formality)
          ..add('gender', gender)
          ..add('material', material)
          ..add('mock', mock)
          ..add('pattern', pattern)
          ..add('season', season)
          ..add('sleeveLength', sleeveLength)
          ..add('style', style)
          ..add('subcategory', subcategory))
        .toString();
  }
}

class DetectionBuilder implements Builder<Detection, DetectionBuilder> {
  _$Detection? _$v;

  String? _category;
  String? get category => _$this._category;
  set category(String? category) => _$this._category = category;

  ListBuilder<String>? _colors;
  ListBuilder<String> get colors => _$this._colors ??= ListBuilder<String>();
  set colors(ListBuilder<String>? colors) => _$this._colors = colors;

  MapBuilder<String, num>? _confidence;
  MapBuilder<String, num> get confidence => _$this._confidence ??= MapBuilder<String, num>();
  set confidence(MapBuilder<String, num>? confidence) => _$this._confidence = confidence;

  String? _fit;
  String? get fit => _$this._fit;
  set fit(String? fit) => _$this._fit = fit;

  String? _formality;
  String? get formality => _$this._formality;
  set formality(String? formality) => _$this._formality = formality;

  String? _gender;
  String? get gender => _$this._gender;
  set gender(String? gender) => _$this._gender = gender;

  String? _material;
  String? get material => _$this._material;
  set material(String? material) => _$this._material = material;

  bool? _mock;
  bool? get mock => _$this._mock;
  set mock(bool? mock) => _$this._mock = mock;

  String? _pattern;
  String? get pattern => _$this._pattern;
  set pattern(String? pattern) => _$this._pattern = pattern;

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

  DetectionBuilder() {
    Detection._defaults(this);
  }

  DetectionBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _colors = $v.colors.toBuilder();
      _confidence = $v.confidence.toBuilder();
      _fit = $v.fit;
      _formality = $v.formality;
      _gender = $v.gender;
      _material = $v.material;
      _mock = $v.mock;
      _pattern = $v.pattern;
      _season = $v.season.toBuilder();
      _sleeveLength = $v.sleeveLength;
      _style = $v.style;
      _subcategory = $v.subcategory;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(Detection other) {
    _$v = other as _$Detection;
  }

  @override
  void update(void Function(DetectionBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  Detection build() => _build();

  _$Detection _build() {
    _$Detection _$result;
    try {
      _$result =
          _$v ??
          _$Detection._(
            category: BuiltValueNullFieldError.checkNotNull(category, r'Detection', 'category'),
            colors: colors.build(),
            confidence: confidence.build(),
            fit: fit,
            formality: formality,
            gender: gender,
            material: material,
            mock: BuiltValueNullFieldError.checkNotNull(mock, r'Detection', 'mock'),
            pattern: pattern,
            season: season.build(),
            sleeveLength: sleeveLength,
            style: style,
            subcategory: subcategory,
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colors';
        colors.build();
        _$failedField = 'confidence';
        confidence.build();

        _$failedField = 'season';
        season.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'Detection', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
