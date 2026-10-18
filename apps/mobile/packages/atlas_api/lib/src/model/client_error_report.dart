//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'client_error_report.g.dart';

/// ClientErrorReport
///
/// Properties:
/// * [appVersion] - App version and build, e.g. 0.1.0+1 (web: the build id)
/// * [errorType]
/// * [fatal]
/// * [kind] - flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
/// * [message] - Scrubbed by the app: no user text, e-mail addresses, tokens or URL queries
/// * [occurredAt] - Device clock
/// * [osVersion]
/// * [platform]
/// * [route] - Screen path with ids replaced by :id
/// * [stack]
@BuiltValue()
abstract class ClientErrorReport implements Built<ClientErrorReport, ClientErrorReportBuilder> {
  /// App version and build, e.g. 0.1.0+1 (web: the build id)
  @BuiltValueField(wireName: r'appVersion')
  String get appVersion;

  @BuiltValueField(wireName: r'errorType')
  String get errorType;

  @BuiltValueField(wireName: r'fatal')
  bool? get fatal;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueField(wireName: r'kind')
  ClientErrorReportKindEnum get kind;
  // enum kindEnum {  flutter,  dart,  android_java,  android_native,  android_anr,  web_error,  web_rejection,  react,  };

  /// Scrubbed by the app: no user text, e-mail addresses, tokens or URL queries
  @BuiltValueField(wireName: r'message')
  String get message;

  /// Device clock
  @BuiltValueField(wireName: r'occurredAt')
  DateTime? get occurredAt;

  @BuiltValueField(wireName: r'osVersion')
  String? get osVersion;

  @BuiltValueField(wireName: r'platform')
  ClientErrorReportPlatformEnum get platform;
  // enum platformEnum {  android,  ios,  web,  };

  /// Screen path with ids replaced by :id
  @BuiltValueField(wireName: r'route')
  String? get route;

  @BuiltValueField(wireName: r'stack')
  String? get stack;

  ClientErrorReport._();

  factory ClientErrorReport([void updates(ClientErrorReportBuilder b)]) = _$ClientErrorReport;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ClientErrorReportBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ClientErrorReport> get serializer => _$ClientErrorReportSerializer();
}

class _$ClientErrorReportSerializer implements PrimitiveSerializer<ClientErrorReport> {
  @override
  final Iterable<Type> types = const [ClientErrorReport, _$ClientErrorReport];

  @override
  final String wireName = r'ClientErrorReport';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ClientErrorReport object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'appVersion';
    yield serializers.serialize(object.appVersion, specifiedType: const FullType(String));
    yield r'errorType';
    yield serializers.serialize(object.errorType, specifiedType: const FullType(String));
    if (object.fatal != null) {
      yield r'fatal';
      yield serializers.serialize(object.fatal, specifiedType: const FullType(bool));
    }
    yield r'kind';
    yield serializers.serialize(object.kind, specifiedType: const FullType(ClientErrorReportKindEnum));
    yield r'message';
    yield serializers.serialize(object.message, specifiedType: const FullType(String));
    if (object.occurredAt != null) {
      yield r'occurredAt';
      yield serializers.serialize(object.occurredAt, specifiedType: const FullType(DateTime));
    }
    if (object.osVersion != null) {
      yield r'osVersion';
      yield serializers.serialize(object.osVersion, specifiedType: const FullType(String));
    }
    yield r'platform';
    yield serializers.serialize(object.platform, specifiedType: const FullType(ClientErrorReportPlatformEnum));
    if (object.route != null) {
      yield r'route';
      yield serializers.serialize(object.route, specifiedType: const FullType(String));
    }
    if (object.stack != null) {
      yield r'stack';
      yield serializers.serialize(object.stack, specifiedType: const FullType(String));
    }
  }

  @override
  Object serialize(Serializers serializers, ClientErrorReport object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ClientErrorReportBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'appVersion':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.appVersion = valueDes;
          break;
        case r'errorType':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.errorType = valueDes;
          break;
        case r'fatal':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.fatal = valueDes;
          break;
        case r'kind':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ClientErrorReportKindEnum),
          ) as ClientErrorReportKindEnum;
          result.kind = valueDes;
          break;
        case r'message':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.message = valueDes;
          break;
        case r'occurredAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.occurredAt = valueDes;
          break;
        case r'osVersion':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.osVersion = valueDes;
          break;
        case r'platform':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ClientErrorReportPlatformEnum),
          ) as ClientErrorReportPlatformEnum;
          result.platform = valueDes;
          break;
        case r'route':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.route = valueDes;
          break;
        case r'stack':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.stack = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ClientErrorReport deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ClientErrorReportBuilder();
    final serializedList = (serialized as Iterable<Object?>).toList();
    final unhandled = <Object?>[];
    _deserializeProperties(
      serializers,
      serialized,
      specifiedType: specifiedType,
      serializedList: serializedList,
      unhandled: unhandled,
      result: result,
    );
    return result.build();
  }
}

class ClientErrorReportKindEnum extends EnumClass {
  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'flutter')
  static const ClientErrorReportKindEnum flutter = _$clientErrorReportKindEnum_flutter;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'dart')
  static const ClientErrorReportKindEnum dart = _$clientErrorReportKindEnum_dart;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'android_java')
  static const ClientErrorReportKindEnum androidJava = _$clientErrorReportKindEnum_androidJava;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'android_native')
  static const ClientErrorReportKindEnum androidNative = _$clientErrorReportKindEnum_androidNative;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'android_anr')
  static const ClientErrorReportKindEnum androidAnr = _$clientErrorReportKindEnum_androidAnr;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'web_error')
  static const ClientErrorReportKindEnum webError = _$clientErrorReportKindEnum_webError;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'web_rejection')
  static const ClientErrorReportKindEnum webRejection = _$clientErrorReportKindEnum_webRejection;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'react')
  static const ClientErrorReportKindEnum react = _$clientErrorReportKindEnum_react;

  /// flutter: a framework error; dart: an uncaught async error; android_*: a Java/Kotlin exception, a native crash or an ANR that ended the Android app (sent at its next start); web_*: window error / unhandled rejection; react: an error boundary
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ClientErrorReportKindEnum unknownDefaultOpenApi = _$clientErrorReportKindEnum_unknownDefaultOpenApi;

  static Serializer<ClientErrorReportKindEnum> get serializer => _$clientErrorReportKindEnumSerializer;

  const ClientErrorReportKindEnum._(String name) : super(name);

  static BuiltSet<ClientErrorReportKindEnum> get values => _$clientErrorReportKindEnumValues;
  static ClientErrorReportKindEnum valueOf(String name) => _$clientErrorReportKindEnumValueOf(name);
}

class ClientErrorReportPlatformEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'android')
  static const ClientErrorReportPlatformEnum android = _$clientErrorReportPlatformEnum_android;
  @BuiltValueEnumConst(wireName: r'ios')
  static const ClientErrorReportPlatformEnum ios = _$clientErrorReportPlatformEnum_ios;
  @BuiltValueEnumConst(wireName: r'web')
  static const ClientErrorReportPlatformEnum web = _$clientErrorReportPlatformEnum_web;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ClientErrorReportPlatformEnum unknownDefaultOpenApi =
      _$clientErrorReportPlatformEnum_unknownDefaultOpenApi;

  static Serializer<ClientErrorReportPlatformEnum> get serializer => _$clientErrorReportPlatformEnumSerializer;

  const ClientErrorReportPlatformEnum._(String name) : super(name);

  static BuiltSet<ClientErrorReportPlatformEnum> get values => _$clientErrorReportPlatformEnumValues;
  static ClientErrorReportPlatformEnum valueOf(String name) => _$clientErrorReportPlatformEnumValueOf(name);
}
