// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'client_error_report.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ClientErrorReportKindEnum _$clientErrorReportKindEnum_flutter = const ClientErrorReportKindEnum._('flutter');
const ClientErrorReportKindEnum _$clientErrorReportKindEnum_dart = const ClientErrorReportKindEnum._('dart');
const ClientErrorReportKindEnum _$clientErrorReportKindEnum_webError = const ClientErrorReportKindEnum._('webError');
const ClientErrorReportKindEnum _$clientErrorReportKindEnum_webRejection = const ClientErrorReportKindEnum._(
  'webRejection',
);
const ClientErrorReportKindEnum _$clientErrorReportKindEnum_react = const ClientErrorReportKindEnum._('react');
const ClientErrorReportKindEnum _$clientErrorReportKindEnum_unknownDefaultOpenApi = const ClientErrorReportKindEnum._(
  'unknownDefaultOpenApi',
);

ClientErrorReportKindEnum _$clientErrorReportKindEnumValueOf(String name) {
  switch (name) {
    case 'flutter':
      return _$clientErrorReportKindEnum_flutter;
    case 'dart':
      return _$clientErrorReportKindEnum_dart;
    case 'webError':
      return _$clientErrorReportKindEnum_webError;
    case 'webRejection':
      return _$clientErrorReportKindEnum_webRejection;
    case 'react':
      return _$clientErrorReportKindEnum_react;
    case 'unknownDefaultOpenApi':
      return _$clientErrorReportKindEnum_unknownDefaultOpenApi;
    default:
      return _$clientErrorReportKindEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ClientErrorReportKindEnum> _$clientErrorReportKindEnumValues = BuiltSet<ClientErrorReportKindEnum>(
  const <ClientErrorReportKindEnum>[
    _$clientErrorReportKindEnum_flutter,
    _$clientErrorReportKindEnum_dart,
    _$clientErrorReportKindEnum_webError,
    _$clientErrorReportKindEnum_webRejection,
    _$clientErrorReportKindEnum_react,
    _$clientErrorReportKindEnum_unknownDefaultOpenApi,
  ],
);

const ClientErrorReportPlatformEnum _$clientErrorReportPlatformEnum_android = const ClientErrorReportPlatformEnum._(
  'android',
);
const ClientErrorReportPlatformEnum _$clientErrorReportPlatformEnum_ios = const ClientErrorReportPlatformEnum._('ios');
const ClientErrorReportPlatformEnum _$clientErrorReportPlatformEnum_web = const ClientErrorReportPlatformEnum._('web');
const ClientErrorReportPlatformEnum _$clientErrorReportPlatformEnum_unknownDefaultOpenApi =
    const ClientErrorReportPlatformEnum._('unknownDefaultOpenApi');

ClientErrorReportPlatformEnum _$clientErrorReportPlatformEnumValueOf(String name) {
  switch (name) {
    case 'android':
      return _$clientErrorReportPlatformEnum_android;
    case 'ios':
      return _$clientErrorReportPlatformEnum_ios;
    case 'web':
      return _$clientErrorReportPlatformEnum_web;
    case 'unknownDefaultOpenApi':
      return _$clientErrorReportPlatformEnum_unknownDefaultOpenApi;
    default:
      return _$clientErrorReportPlatformEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ClientErrorReportPlatformEnum> _$clientErrorReportPlatformEnumValues =
    BuiltSet<ClientErrorReportPlatformEnum>(const <ClientErrorReportPlatformEnum>[
      _$clientErrorReportPlatformEnum_android,
      _$clientErrorReportPlatformEnum_ios,
      _$clientErrorReportPlatformEnum_web,
      _$clientErrorReportPlatformEnum_unknownDefaultOpenApi,
    ]);

Serializer<ClientErrorReportKindEnum> _$clientErrorReportKindEnumSerializer = _$ClientErrorReportKindEnumSerializer();
Serializer<ClientErrorReportPlatformEnum> _$clientErrorReportPlatformEnumSerializer =
    _$ClientErrorReportPlatformEnumSerializer();

class _$ClientErrorReportKindEnumSerializer implements PrimitiveSerializer<ClientErrorReportKindEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'flutter': 'flutter',
    'dart': 'dart',
    'webError': 'web_error',
    'webRejection': 'web_rejection',
    'react': 'react',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'flutter': 'flutter',
    'dart': 'dart',
    'web_error': 'webError',
    'web_rejection': 'webRejection',
    'react': 'react',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ClientErrorReportKindEnum];
  @override
  final String wireName = 'ClientErrorReportKindEnum';

  @override
  Object serialize(
    Serializers serializers,
    ClientErrorReportKindEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ClientErrorReportKindEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ClientErrorReportKindEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ClientErrorReportPlatformEnumSerializer implements PrimitiveSerializer<ClientErrorReportPlatformEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'android': 'android',
    'ios': 'ios',
    'web': 'web',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'android': 'android',
    'ios': 'ios',
    'web': 'web',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ClientErrorReportPlatformEnum];
  @override
  final String wireName = 'ClientErrorReportPlatformEnum';

  @override
  Object serialize(
    Serializers serializers,
    ClientErrorReportPlatformEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ClientErrorReportPlatformEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ClientErrorReportPlatformEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ClientErrorReport extends ClientErrorReport {
  @override
  final String appVersion;
  @override
  final String errorType;
  @override
  final bool? fatal;
  @override
  final ClientErrorReportKindEnum kind;
  @override
  final String message;
  @override
  final DateTime? occurredAt;
  @override
  final String? osVersion;
  @override
  final ClientErrorReportPlatformEnum platform;
  @override
  final String? route;
  @override
  final String? stack;

  factory _$ClientErrorReport([void Function(ClientErrorReportBuilder)? updates]) =>
      (ClientErrorReportBuilder()..update(updates))._build();

  _$ClientErrorReport._({
    required this.appVersion,
    required this.errorType,
    this.fatal,
    required this.kind,
    required this.message,
    this.occurredAt,
    this.osVersion,
    required this.platform,
    this.route,
    this.stack,
  }) : super._();
  @override
  ClientErrorReport rebuild(void Function(ClientErrorReportBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ClientErrorReportBuilder toBuilder() => ClientErrorReportBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ClientErrorReport &&
        appVersion == other.appVersion &&
        errorType == other.errorType &&
        fatal == other.fatal &&
        kind == other.kind &&
        message == other.message &&
        occurredAt == other.occurredAt &&
        osVersion == other.osVersion &&
        platform == other.platform &&
        route == other.route &&
        stack == other.stack;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, appVersion.hashCode);
    _$hash = $jc(_$hash, errorType.hashCode);
    _$hash = $jc(_$hash, fatal.hashCode);
    _$hash = $jc(_$hash, kind.hashCode);
    _$hash = $jc(_$hash, message.hashCode);
    _$hash = $jc(_$hash, occurredAt.hashCode);
    _$hash = $jc(_$hash, osVersion.hashCode);
    _$hash = $jc(_$hash, platform.hashCode);
    _$hash = $jc(_$hash, route.hashCode);
    _$hash = $jc(_$hash, stack.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ClientErrorReport')
          ..add('appVersion', appVersion)
          ..add('errorType', errorType)
          ..add('fatal', fatal)
          ..add('kind', kind)
          ..add('message', message)
          ..add('occurredAt', occurredAt)
          ..add('osVersion', osVersion)
          ..add('platform', platform)
          ..add('route', route)
          ..add('stack', stack))
        .toString();
  }
}

class ClientErrorReportBuilder implements Builder<ClientErrorReport, ClientErrorReportBuilder> {
  _$ClientErrorReport? _$v;

  String? _appVersion;
  String? get appVersion => _$this._appVersion;
  set appVersion(String? appVersion) => _$this._appVersion = appVersion;

  String? _errorType;
  String? get errorType => _$this._errorType;
  set errorType(String? errorType) => _$this._errorType = errorType;

  bool? _fatal;
  bool? get fatal => _$this._fatal;
  set fatal(bool? fatal) => _$this._fatal = fatal;

  ClientErrorReportKindEnum? _kind;
  ClientErrorReportKindEnum? get kind => _$this._kind;
  set kind(ClientErrorReportKindEnum? kind) => _$this._kind = kind;

  String? _message;
  String? get message => _$this._message;
  set message(String? message) => _$this._message = message;

  DateTime? _occurredAt;
  DateTime? get occurredAt => _$this._occurredAt;
  set occurredAt(DateTime? occurredAt) => _$this._occurredAt = occurredAt;

  String? _osVersion;
  String? get osVersion => _$this._osVersion;
  set osVersion(String? osVersion) => _$this._osVersion = osVersion;

  ClientErrorReportPlatformEnum? _platform;
  ClientErrorReportPlatformEnum? get platform => _$this._platform;
  set platform(ClientErrorReportPlatformEnum? platform) => _$this._platform = platform;

  String? _route;
  String? get route => _$this._route;
  set route(String? route) => _$this._route = route;

  String? _stack;
  String? get stack => _$this._stack;
  set stack(String? stack) => _$this._stack = stack;

  ClientErrorReportBuilder() {
    ClientErrorReport._defaults(this);
  }

  ClientErrorReportBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _appVersion = $v.appVersion;
      _errorType = $v.errorType;
      _fatal = $v.fatal;
      _kind = $v.kind;
      _message = $v.message;
      _occurredAt = $v.occurredAt;
      _osVersion = $v.osVersion;
      _platform = $v.platform;
      _route = $v.route;
      _stack = $v.stack;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ClientErrorReport other) {
    _$v = other as _$ClientErrorReport;
  }

  @override
  void update(void Function(ClientErrorReportBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ClientErrorReport build() => _build();

  _$ClientErrorReport _build() {
    final _$result =
        _$v ??
        _$ClientErrorReport._(
          appVersion: BuiltValueNullFieldError.checkNotNull(appVersion, r'ClientErrorReport', 'appVersion'),
          errorType: BuiltValueNullFieldError.checkNotNull(errorType, r'ClientErrorReport', 'errorType'),
          fatal: fatal,
          kind: BuiltValueNullFieldError.checkNotNull(kind, r'ClientErrorReport', 'kind'),
          message: BuiltValueNullFieldError.checkNotNull(message, r'ClientErrorReport', 'message'),
          occurredAt: occurredAt,
          osVersion: osVersion,
          platform: BuiltValueNullFieldError.checkNotNull(platform, r'ClientErrorReport', 'platform'),
          route: route,
          stack: stack,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
