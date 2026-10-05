// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'color_profile_response_one_of1.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ColorProfileResponseOneOf1StatusEnum _$colorProfileResponseOneOf1StatusEnum_analyzed =
    const ColorProfileResponseOneOf1StatusEnum._('analyzed');
const ColorProfileResponseOneOf1StatusEnum _$colorProfileResponseOneOf1StatusEnum_unknownDefaultOpenApi =
    const ColorProfileResponseOneOf1StatusEnum._('unknownDefaultOpenApi');

ColorProfileResponseOneOf1StatusEnum _$colorProfileResponseOneOf1StatusEnumValueOf(String name) {
  switch (name) {
    case 'analyzed':
      return _$colorProfileResponseOneOf1StatusEnum_analyzed;
    case 'unknownDefaultOpenApi':
      return _$colorProfileResponseOneOf1StatusEnum_unknownDefaultOpenApi;
    default:
      return _$colorProfileResponseOneOf1StatusEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ColorProfileResponseOneOf1StatusEnum> _$colorProfileResponseOneOf1StatusEnumValues =
    BuiltSet<ColorProfileResponseOneOf1StatusEnum>(const <ColorProfileResponseOneOf1StatusEnum>[
      _$colorProfileResponseOneOf1StatusEnum_analyzed,
      _$colorProfileResponseOneOf1StatusEnum_unknownDefaultOpenApi,
    ]);

Serializer<ColorProfileResponseOneOf1StatusEnum> _$colorProfileResponseOneOf1StatusEnumSerializer =
    _$ColorProfileResponseOneOf1StatusEnumSerializer();

class _$ColorProfileResponseOneOf1StatusEnumSerializer
    implements PrimitiveSerializer<ColorProfileResponseOneOf1StatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'analyzed': 'analyzed',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'analyzed': 'analyzed',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ColorProfileResponseOneOf1StatusEnum];
  @override
  final String wireName = 'ColorProfileResponseOneOf1StatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    ColorProfileResponseOneOf1StatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ColorProfileResponseOneOf1StatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ColorProfileResponseOneOf1StatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ColorProfileResponseOneOf1 extends ColorProfileResponseOneOf1 {
  @override
  final ColorProfileResponseOneOf1ColorProfile colorProfile;
  @override
  final String disclaimer;
  @override
  final ColorProfileResponseOneOf1StatusEnum status;

  factory _$ColorProfileResponseOneOf1([void Function(ColorProfileResponseOneOf1Builder)? updates]) =>
      (ColorProfileResponseOneOf1Builder()..update(updates))._build();

  _$ColorProfileResponseOneOf1._({required this.colorProfile, required this.disclaimer, required this.status})
    : super._();
  @override
  ColorProfileResponseOneOf1 rebuild(void Function(ColorProfileResponseOneOf1Builder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ColorProfileResponseOneOf1Builder toBuilder() => ColorProfileResponseOneOf1Builder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ColorProfileResponseOneOf1 &&
        colorProfile == other.colorProfile &&
        disclaimer == other.disclaimer &&
        status == other.status;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, colorProfile.hashCode);
    _$hash = $jc(_$hash, disclaimer.hashCode);
    _$hash = $jc(_$hash, status.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ColorProfileResponseOneOf1')
          ..add('colorProfile', colorProfile)
          ..add('disclaimer', disclaimer)
          ..add('status', status))
        .toString();
  }
}

class ColorProfileResponseOneOf1Builder
    implements Builder<ColorProfileResponseOneOf1, ColorProfileResponseOneOf1Builder> {
  _$ColorProfileResponseOneOf1? _$v;

  ColorProfileResponseOneOf1ColorProfileBuilder? _colorProfile;
  ColorProfileResponseOneOf1ColorProfileBuilder get colorProfile =>
      _$this._colorProfile ??= ColorProfileResponseOneOf1ColorProfileBuilder();
  set colorProfile(ColorProfileResponseOneOf1ColorProfileBuilder? colorProfile) => _$this._colorProfile = colorProfile;

  String? _disclaimer;
  String? get disclaimer => _$this._disclaimer;
  set disclaimer(String? disclaimer) => _$this._disclaimer = disclaimer;

  ColorProfileResponseOneOf1StatusEnum? _status;
  ColorProfileResponseOneOf1StatusEnum? get status => _$this._status;
  set status(ColorProfileResponseOneOf1StatusEnum? status) => _$this._status = status;

  ColorProfileResponseOneOf1Builder() {
    ColorProfileResponseOneOf1._defaults(this);
  }

  ColorProfileResponseOneOf1Builder get _$this {
    final $v = _$v;
    if ($v != null) {
      _colorProfile = $v.colorProfile.toBuilder();
      _disclaimer = $v.disclaimer;
      _status = $v.status;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ColorProfileResponseOneOf1 other) {
    _$v = other as _$ColorProfileResponseOneOf1;
  }

  @override
  void update(void Function(ColorProfileResponseOneOf1Builder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ColorProfileResponseOneOf1 build() => _build();

  _$ColorProfileResponseOneOf1 _build() {
    _$ColorProfileResponseOneOf1 _$result;
    try {
      _$result =
          _$v ??
          _$ColorProfileResponseOneOf1._(
            colorProfile: colorProfile.build(),
            disclaimer: BuiltValueNullFieldError.checkNotNull(disclaimer, r'ColorProfileResponseOneOf1', 'disclaimer'),
            status: BuiltValueNullFieldError.checkNotNull(status, r'ColorProfileResponseOneOf1', 'status'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'colorProfile';
        colorProfile.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ColorProfileResponseOneOf1', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
