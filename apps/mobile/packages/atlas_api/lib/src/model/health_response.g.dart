// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'health_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const HealthResponseDatabaseEnum _$healthResponseDatabaseEnum_ok = const HealthResponseDatabaseEnum._('ok');
const HealthResponseDatabaseEnum _$healthResponseDatabaseEnum_unreachable = const HealthResponseDatabaseEnum._(
  'unreachable',
);
const HealthResponseDatabaseEnum _$healthResponseDatabaseEnum_unknownDefaultOpenApi =
    const HealthResponseDatabaseEnum._('unknownDefaultOpenApi');

HealthResponseDatabaseEnum _$healthResponseDatabaseEnumValueOf(String name) {
  switch (name) {
    case 'ok':
      return _$healthResponseDatabaseEnum_ok;
    case 'unreachable':
      return _$healthResponseDatabaseEnum_unreachable;
    case 'unknownDefaultOpenApi':
      return _$healthResponseDatabaseEnum_unknownDefaultOpenApi;
    default:
      return _$healthResponseDatabaseEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<HealthResponseDatabaseEnum> _$healthResponseDatabaseEnumValues = BuiltSet<HealthResponseDatabaseEnum>(
  const <HealthResponseDatabaseEnum>[
    _$healthResponseDatabaseEnum_ok,
    _$healthResponseDatabaseEnum_unreachable,
    _$healthResponseDatabaseEnum_unknownDefaultOpenApi,
  ],
);

const HealthResponseStatusEnum _$healthResponseStatusEnum_ok = const HealthResponseStatusEnum._('ok');
const HealthResponseStatusEnum _$healthResponseStatusEnum_degraded = const HealthResponseStatusEnum._('degraded');
const HealthResponseStatusEnum _$healthResponseStatusEnum_unknownDefaultOpenApi = const HealthResponseStatusEnum._(
  'unknownDefaultOpenApi',
);

HealthResponseStatusEnum _$healthResponseStatusEnumValueOf(String name) {
  switch (name) {
    case 'ok':
      return _$healthResponseStatusEnum_ok;
    case 'degraded':
      return _$healthResponseStatusEnum_degraded;
    case 'unknownDefaultOpenApi':
      return _$healthResponseStatusEnum_unknownDefaultOpenApi;
    default:
      return _$healthResponseStatusEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<HealthResponseStatusEnum> _$healthResponseStatusEnumValues = BuiltSet<HealthResponseStatusEnum>(
  const <HealthResponseStatusEnum>[
    _$healthResponseStatusEnum_ok,
    _$healthResponseStatusEnum_degraded,
    _$healthResponseStatusEnum_unknownDefaultOpenApi,
  ],
);

Serializer<HealthResponseDatabaseEnum> _$healthResponseDatabaseEnumSerializer =
    _$HealthResponseDatabaseEnumSerializer();
Serializer<HealthResponseStatusEnum> _$healthResponseStatusEnumSerializer = _$HealthResponseStatusEnumSerializer();

class _$HealthResponseDatabaseEnumSerializer implements PrimitiveSerializer<HealthResponseDatabaseEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'ok': 'ok',
    'unreachable': 'unreachable',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'ok': 'ok',
    'unreachable': 'unreachable',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[HealthResponseDatabaseEnum];
  @override
  final String wireName = 'HealthResponseDatabaseEnum';

  @override
  Object serialize(
    Serializers serializers,
    HealthResponseDatabaseEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  HealthResponseDatabaseEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => HealthResponseDatabaseEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$HealthResponseStatusEnumSerializer implements PrimitiveSerializer<HealthResponseStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'ok': 'ok',
    'degraded': 'degraded',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'ok': 'ok',
    'degraded': 'degraded',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[HealthResponseStatusEnum];
  @override
  final String wireName = 'HealthResponseStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    HealthResponseStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  HealthResponseStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => HealthResponseStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$HealthResponse extends HealthResponse {
  @override
  final HealthResponseDatabaseEnum database;
  @override
  final HealthResponseStatusEnum status;
  @override
  final String version;

  factory _$HealthResponse([void Function(HealthResponseBuilder)? updates]) =>
      (HealthResponseBuilder()..update(updates))._build();

  _$HealthResponse._({required this.database, required this.status, required this.version}) : super._();
  @override
  HealthResponse rebuild(void Function(HealthResponseBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  HealthResponseBuilder toBuilder() => HealthResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is HealthResponse && database == other.database && status == other.status && version == other.version;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, database.hashCode);
    _$hash = $jc(_$hash, status.hashCode);
    _$hash = $jc(_$hash, version.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'HealthResponse')
          ..add('database', database)
          ..add('status', status)
          ..add('version', version))
        .toString();
  }
}

class HealthResponseBuilder implements Builder<HealthResponse, HealthResponseBuilder> {
  _$HealthResponse? _$v;

  HealthResponseDatabaseEnum? _database;
  HealthResponseDatabaseEnum? get database => _$this._database;
  set database(HealthResponseDatabaseEnum? database) => _$this._database = database;

  HealthResponseStatusEnum? _status;
  HealthResponseStatusEnum? get status => _$this._status;
  set status(HealthResponseStatusEnum? status) => _$this._status = status;

  String? _version;
  String? get version => _$this._version;
  set version(String? version) => _$this._version = version;

  HealthResponseBuilder() {
    HealthResponse._defaults(this);
  }

  HealthResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _database = $v.database;
      _status = $v.status;
      _version = $v.version;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(HealthResponse other) {
    _$v = other as _$HealthResponse;
  }

  @override
  void update(void Function(HealthResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  HealthResponse build() => _build();

  _$HealthResponse _build() {
    final _$result =
        _$v ??
        _$HealthResponse._(
          database: BuiltValueNullFieldError.checkNotNull(database, r'HealthResponse', 'database'),
          status: BuiltValueNullFieldError.checkNotNull(status, r'HealthResponse', 'status'),
          version: BuiltValueNullFieldError.checkNotNull(version, r'HealthResponse', 'version'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
