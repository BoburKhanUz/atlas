// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_profile_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ColorProfileResponseStatusEnum _$colorProfileResponseStatusEnum_analyzed = const ColorProfileResponseStatusEnum._(
  'analyzed',
);
const ColorProfileResponseStatusEnum _$colorProfileResponseStatusEnum_unknownDefaultOpenApi =
    const ColorProfileResponseStatusEnum._('unknownDefaultOpenApi');

ColorProfileResponseStatusEnum _$colorProfileResponseStatusEnumValueOf(String name) {
  switch (name) {
    case 'analyzed':
      return _$colorProfileResponseStatusEnum_analyzed;
    case 'unknownDefaultOpenApi':
      return _$colorProfileResponseStatusEnum_unknownDefaultOpenApi;
    default:
      return _$colorProfileResponseStatusEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ColorProfileResponseStatusEnum> _$colorProfileResponseStatusEnumValues =
    BuiltSet<ColorProfileResponseStatusEnum>(const <ColorProfileResponseStatusEnum>[
      _$colorProfileResponseStatusEnum_analyzed,
      _$colorProfileResponseStatusEnum_unknownDefaultOpenApi,
    ]);

Serializer<ColorProfileResponseStatusEnum> _$colorProfileResponseStatusEnumSerializer =
    _$ColorProfileResponseStatusEnumSerializer();

class _$ColorProfileResponseStatusEnumSerializer implements PrimitiveSerializer<ColorProfileResponseStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'analyzed': 'analyzed',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'analyzed': 'analyzed',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ColorProfileResponseStatusEnum];
  @override
  final String wireName = 'ColorProfileResponseStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ColorProfileResponseStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ColorProfileResponseStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ColorProfileResponse extends ColorProfileResponse {
  @override
  final OneOf oneOf;

  factory _$ColorProfileResponse([void Function(ColorProfileResponseBuilder)? updates]) =>
      (ColorProfileResponseBuilder()..update(updates))._build();

  _$ColorProfileResponse._({required this.oneOf}) : super._();
  @override
  ColorProfileResponse rebuild(void Function(ColorProfileResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ColorProfileResponseBuilder toBuilder() => ColorProfileResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorProfileResponse && oneOf == other.oneOf;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, oneOf.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorProfileResponse')..add('oneOf', oneOf)).toString();
  }
}

class ColorProfileResponseBuilder implements Builder<ColorProfileResponse, ColorProfileResponseBuilder> {
  _$ColorProfileResponse? _$v;

  OneOf? _oneOf;
  OneOf? get oneOf => _$this._oneOf;
  set oneOf(OneOf? oneOf) => _$this._oneOf = oneOf;

  ColorProfileResponseBuilder() {
    ColorProfileResponse._defaults(this);
  }

  ColorProfileResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _oneOf = $v.oneOf;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorProfileResponse other) {
    _$v = other as _$ColorProfileResponse;
  }

  @override
  void update(void Function(ColorProfileResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorProfileResponse build() => _build();

  _$ColorProfileResponse _build() {
    final _$result =
        _$v ??
        _$ColorProfileResponse._(oneOf: BuiltValueNullFieldError.checkNotNull(oneOf, r'ColorProfileResponse', 'oneOf'));
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
