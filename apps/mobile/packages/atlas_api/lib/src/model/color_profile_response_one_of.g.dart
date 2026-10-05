// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_profile_response_one_of.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ColorProfileResponseOneOfStatusEnum _$colorProfileResponseOneOfStatusEnum_notAnalyzed =
    const ColorProfileResponseOneOfStatusEnum._('notAnalyzed');
const ColorProfileResponseOneOfStatusEnum _$colorProfileResponseOneOfStatusEnum_unknownDefaultOpenApi =
    const ColorProfileResponseOneOfStatusEnum._('unknownDefaultOpenApi');

ColorProfileResponseOneOfStatusEnum _$colorProfileResponseOneOfStatusEnumValueOf(String name) {
  switch (name) {
    case 'notAnalyzed':
      return _$colorProfileResponseOneOfStatusEnum_notAnalyzed;
    case 'unknownDefaultOpenApi':
      return _$colorProfileResponseOneOfStatusEnum_unknownDefaultOpenApi;
    default:
      return _$colorProfileResponseOneOfStatusEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ColorProfileResponseOneOfStatusEnum> _$colorProfileResponseOneOfStatusEnumValues =
    BuiltSet<ColorProfileResponseOneOfStatusEnum>(const <ColorProfileResponseOneOfStatusEnum>[
      _$colorProfileResponseOneOfStatusEnum_notAnalyzed,
      _$colorProfileResponseOneOfStatusEnum_unknownDefaultOpenApi,
    ]);

Serializer<ColorProfileResponseOneOfStatusEnum> _$colorProfileResponseOneOfStatusEnumSerializer =
    _$ColorProfileResponseOneOfStatusEnumSerializer();

class _$ColorProfileResponseOneOfStatusEnumSerializer
    implements PrimitiveSerializer<ColorProfileResponseOneOfStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'notAnalyzed': 'not_analyzed',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'not_analyzed': 'notAnalyzed',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ColorProfileResponseOneOfStatusEnum];
  @override
  final String wireName = 'ColorProfileResponseOneOfStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseOneOfStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ColorProfileResponseOneOfStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ColorProfileResponseOneOfStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ColorProfileResponseOneOf extends ColorProfileResponseOneOf {
  @override
  final JsonObject? colorProfile;
  @override
  final String message;
  @override
  final ColorProfileResponseOneOfStatusEnum status;

  factory _$ColorProfileResponseOneOf([void Function(ColorProfileResponseOneOfBuilder)? updates]) =>
      (ColorProfileResponseOneOfBuilder()..update(updates))._build();

  _$ColorProfileResponseOneOf._({this.colorProfile, required this.message, required this.status}) : super._();
  @override
  ColorProfileResponseOneOf rebuild(void Function(ColorProfileResponseOneOfBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ColorProfileResponseOneOfBuilder toBuilder() => ColorProfileResponseOneOfBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorProfileResponseOneOf &&
        colorProfile == other.colorProfile &&
        message == other.message &&
        status == other.status;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, colorProfile.hashCode);
    _$hash = $jc(_$hash, message.hashCode);
    _$hash = $jc(_$hash, status.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorProfileResponseOneOf')
          ..add('colorProfile', colorProfile)
          ..add('message', message)
          ..add('status', status))
        .toString();
  }
}

class ColorProfileResponseOneOfBuilder implements Builder<ColorProfileResponseOneOf, ColorProfileResponseOneOfBuilder> {
  _$ColorProfileResponseOneOf? _$v;

  JsonObject? _colorProfile;
  JsonObject? get colorProfile => _$this._colorProfile;
  set colorProfile(JsonObject? colorProfile) => _$this._colorProfile = colorProfile;

  String? _message;
  String? get message => _$this._message;
  set message(String? message) => _$this._message = message;

  ColorProfileResponseOneOfStatusEnum? _status;
  ColorProfileResponseOneOfStatusEnum? get status => _$this._status;
  set status(ColorProfileResponseOneOfStatusEnum? status) => _$this._status = status;

  ColorProfileResponseOneOfBuilder() {
    ColorProfileResponseOneOf._defaults(this);
  }

  ColorProfileResponseOneOfBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _colorProfile = $v.colorProfile;
      _message = $v.message;
      _status = $v.status;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorProfileResponseOneOf other) {
    _$v = other as _$ColorProfileResponseOneOf;
  }

  @override
  void update(void Function(ColorProfileResponseOneOfBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorProfileResponseOneOf build() => _build();

  _$ColorProfileResponseOneOf _build() {
    final _$result =
        _$v ??
        _$ColorProfileResponseOneOf._(
          colorProfile: colorProfile,
          message: BuiltValueNullFieldError.checkNotNull(message, r'ColorProfileResponseOneOf', 'message'),
          status: BuiltValueNullFieldError.checkNotNull(status, r'ColorProfileResponseOneOf', 'status'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
