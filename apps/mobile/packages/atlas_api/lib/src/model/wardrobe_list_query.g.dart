// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_list_query.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_all = const WardrobeListQueryCategoryEnum._('all');
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_outerwear = const WardrobeListQueryCategoryEnum._(
  'outerwear',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_shirt = const WardrobeListQueryCategoryEnum._(
  'shirt',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_pants = const WardrobeListQueryCategoryEnum._(
  'pants',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_dress = const WardrobeListQueryCategoryEnum._(
  'dress',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_shoes = const WardrobeListQueryCategoryEnum._(
  'shoes',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_bag = const WardrobeListQueryCategoryEnum._('bag');
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_accessory = const WardrobeListQueryCategoryEnum._(
  'accessory',
);
const WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnum_unknownDefaultOpenApi =
    const WardrobeListQueryCategoryEnum._('unknownDefaultOpenApi');

WardrobeListQueryCategoryEnum _$wardrobeListQueryCategoryEnumValueOf(String name) {
  switch (name) {
    case 'all':
      return _$wardrobeListQueryCategoryEnum_all;
    case 'outerwear':
      return _$wardrobeListQueryCategoryEnum_outerwear;
    case 'shirt':
      return _$wardrobeListQueryCategoryEnum_shirt;
    case 'pants':
      return _$wardrobeListQueryCategoryEnum_pants;
    case 'dress':
      return _$wardrobeListQueryCategoryEnum_dress;
    case 'shoes':
      return _$wardrobeListQueryCategoryEnum_shoes;
    case 'bag':
      return _$wardrobeListQueryCategoryEnum_bag;
    case 'accessory':
      return _$wardrobeListQueryCategoryEnum_accessory;
    case 'unknownDefaultOpenApi':
      return _$wardrobeListQueryCategoryEnum_unknownDefaultOpenApi;
    default:
      return _$wardrobeListQueryCategoryEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<WardrobeListQueryCategoryEnum> _$wardrobeListQueryCategoryEnumValues =
    BuiltSet<WardrobeListQueryCategoryEnum>(const <WardrobeListQueryCategoryEnum>[
      _$wardrobeListQueryCategoryEnum_all,
      _$wardrobeListQueryCategoryEnum_outerwear,
      _$wardrobeListQueryCategoryEnum_shirt,
      _$wardrobeListQueryCategoryEnum_pants,
      _$wardrobeListQueryCategoryEnum_dress,
      _$wardrobeListQueryCategoryEnum_shoes,
      _$wardrobeListQueryCategoryEnum_bag,
      _$wardrobeListQueryCategoryEnum_accessory,
      _$wardrobeListQueryCategoryEnum_unknownDefaultOpenApi,
    ]);

Serializer<WardrobeListQueryCategoryEnum> _$wardrobeListQueryCategoryEnumSerializer =
    _$WardrobeListQueryCategoryEnumSerializer();

class _$WardrobeListQueryCategoryEnumSerializer implements PrimitiveSerializer<WardrobeListQueryCategoryEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'all': 'all',
    'outerwear': 'outerwear',
    'shirt': 'shirt',
    'pants': 'pants',
    'dress': 'dress',
    'shoes': 'shoes',
    'bag': 'bag',
    'accessory': 'accessory',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'all': 'all',
    'outerwear': 'outerwear',
    'shirt': 'shirt',
    'pants': 'pants',
    'dress': 'dress',
    'shoes': 'shoes',
    'bag': 'bag',
    'accessory': 'accessory',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[WardrobeListQueryCategoryEnum];
  @override
  final String wireName = 'WardrobeListQueryCategoryEnum';

  @override
  Object serialize(
    Serializers serializers,
    WardrobeListQueryCategoryEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  WardrobeListQueryCategoryEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => WardrobeListQueryCategoryEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$WardrobeListQuery extends WardrobeListQuery {
  @override
  final WardrobeListQueryCategoryEnum? category;
  @override
  final String? cursor;
  @override
  final int? limit;

  factory _$WardrobeListQuery([void Function(WardrobeListQueryBuilder)? updates]) =>
      (WardrobeListQueryBuilder()..update(updates))._build();

  _$WardrobeListQuery._({this.category, this.cursor, this.limit}) : super._();
  @override
  WardrobeListQuery rebuild(void Function(WardrobeListQueryBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  WardrobeListQueryBuilder toBuilder() => WardrobeListQueryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobeListQuery && category == other.category && cursor == other.cursor && limit == other.limit;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, category.hashCode);
    _$hash = $jc(_$hash, cursor.hashCode);
    _$hash = $jc(_$hash, limit.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobeListQuery')
          ..add('category', category)
          ..add('cursor', cursor)
          ..add('limit', limit))
        .toString();
  }
}

class WardrobeListQueryBuilder implements Builder<WardrobeListQuery, WardrobeListQueryBuilder> {
  _$WardrobeListQuery? _$v;

  WardrobeListQueryCategoryEnum? _category;
  WardrobeListQueryCategoryEnum? get category => _$this._category;
  set category(WardrobeListQueryCategoryEnum? category) => _$this._category = category;

  String? _cursor;
  String? get cursor => _$this._cursor;
  set cursor(String? cursor) => _$this._cursor = cursor;

  int? _limit;
  int? get limit => _$this._limit;
  set limit(int? limit) => _$this._limit = limit;

  WardrobeListQueryBuilder() {
    WardrobeListQuery._defaults(this);
  }

  WardrobeListQueryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _category = $v.category;
      _cursor = $v.cursor;
      _limit = $v.limit;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobeListQuery other) {
    _$v = other as _$WardrobeListQuery;
  }

  @override
  void update(void Function(WardrobeListQueryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobeListQuery build() => _build();

  _$WardrobeListQuery _build() {
    final _$result = _$v ?? _$WardrobeListQuery._(category: category, cursor: cursor, limit: limit);
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
