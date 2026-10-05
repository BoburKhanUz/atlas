// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_list_query.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitListQuerySavedEnum _$outfitListQuerySavedEnum_n0 = const OutfitListQuerySavedEnum._('n0');
const OutfitListQuerySavedEnum _$outfitListQuerySavedEnum_n1 = const OutfitListQuerySavedEnum._('n1');
const OutfitListQuerySavedEnum _$outfitListQuerySavedEnum_true_ = const OutfitListQuerySavedEnum._('true_');
const OutfitListQuerySavedEnum _$outfitListQuerySavedEnum_false_ = const OutfitListQuerySavedEnum._('false_');
const OutfitListQuerySavedEnum _$outfitListQuerySavedEnum_unknownDefaultOpenApi = const OutfitListQuerySavedEnum._(
  'unknownDefaultOpenApi',
);

OutfitListQuerySavedEnum _$outfitListQuerySavedEnumValueOf(String name) {
  switch (name) {
    case 'n0':
      return _$outfitListQuerySavedEnum_n0;
    case 'n1':
      return _$outfitListQuerySavedEnum_n1;
    case 'true_':
      return _$outfitListQuerySavedEnum_true_;
    case 'false_':
      return _$outfitListQuerySavedEnum_false_;
    case 'unknownDefaultOpenApi':
      return _$outfitListQuerySavedEnum_unknownDefaultOpenApi;
    default:
      return _$outfitListQuerySavedEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitListQuerySavedEnum> _$outfitListQuerySavedEnumValues = BuiltSet<OutfitListQuerySavedEnum>(
  const <OutfitListQuerySavedEnum>[
    _$outfitListQuerySavedEnum_n0,
    _$outfitListQuerySavedEnum_n1,
    _$outfitListQuerySavedEnum_true_,
    _$outfitListQuerySavedEnum_false_,
    _$outfitListQuerySavedEnum_unknownDefaultOpenApi,
  ],
);

Serializer<OutfitListQuerySavedEnum> _$outfitListQuerySavedEnumSerializer = _$OutfitListQuerySavedEnumSerializer();

class _$OutfitListQuerySavedEnumSerializer implements PrimitiveSerializer<OutfitListQuerySavedEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'n0': '0',
    'n1': '1',
    'true_': 'true',
    'false_': 'false',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    '0': 'n0',
    '1': 'n1',
    'true': 'true_',
    'false': 'false_',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[OutfitListQuerySavedEnum];
  @override
  final String wireName = 'OutfitListQuerySavedEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitListQuerySavedEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitListQuerySavedEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitListQuerySavedEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$OutfitListQuery extends OutfitListQuery {
  @override
  final OutfitListQuerySavedEnum? saved;

  factory _$OutfitListQuery([void Function(OutfitListQueryBuilder)? updates]) =>
      (OutfitListQueryBuilder()..update(updates))._build();

  _$OutfitListQuery._({this.saved}) : super._();
  @override
  OutfitListQuery rebuild(void Function(OutfitListQueryBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitListQueryBuilder toBuilder() => OutfitListQueryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitListQuery && saved == other.saved;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, saved.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitListQuery')..add('saved', saved)).toString();
  }
}

class OutfitListQueryBuilder implements Builder<OutfitListQuery, OutfitListQueryBuilder> {
  _$OutfitListQuery? _$v;

  OutfitListQuerySavedEnum? _saved;
  OutfitListQuerySavedEnum? get saved => _$this._saved;
  set saved(OutfitListQuerySavedEnum? saved) => _$this._saved = saved;

  OutfitListQueryBuilder() {
    OutfitListQuery._defaults(this);
  }

  OutfitListQueryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _saved = $v.saved;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitListQuery other) {
    _$v = other as _$OutfitListQuery;
  }

  @override
  void update(void Function(OutfitListQueryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitListQuery build() => _build();

  _$OutfitListQuery _build() {
    final _$result = _$v ?? _$OutfitListQuery._(saved: saved);
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
