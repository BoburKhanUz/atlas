import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/access_token_source.dart';
import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/connectivity.dart';
import 'package:dio/dio.dart';

/// One request as it left the app (after every interceptor).
class SentRequest {
  SentRequest(this.options, this.body);
  final RequestOptions options;
  final Uint8List body;

  String get method => options.method;
  Uri get uri => options.uri;
  Map<String, Object?> get headers => options.headers;
  String get bodyText => utf8.decode(body, allowMalformed: true);

  /// Header lookup, case-insensitive.
  Object? header(String name) =>
      headers.entries.where((e) => e.key.toLowerCase() == name.toLowerCase()).map((e) => e.value).firstOrNull;
}

/// What the fake server does for one request.
sealed class FakeReply {}

class JsonReply extends FakeReply {
  JsonReply(this.status, this.body, {this.headers = const {}});
  final int status;
  final Object? body;
  final Map<String, String> headers;
}

class RawReply extends FakeReply {
  RawReply(this.status, this.text, {this.contentType = 'text/html'});
  final int status;
  final String text;
  final String contentType;
}

/// A transport failure (timeout, refused connection, …).
class TransportFailure extends FakeReply {
  TransportFailure(this.type, [this.error]);
  final DioExceptionType type;
  final Object? error;
}

/// Records requests and answers them from a script (one reply per request,
/// the last one repeats).
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.replies);
  final List<FakeReply> replies;
  final sent = <SentRequest>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = <int>[];
    if (requestStream != null) {
      await for (final chunk in requestStream) {
        bytes.addAll(chunk);
      }
    }
    sent.add(SentRequest(options, Uint8List.fromList(bytes)));
    final reply = replies[(sent.length - 1).clamp(0, replies.length - 1)];
    switch (reply) {
      case TransportFailure(:final type, :final error):
        throw DioException(requestOptions: options, type: type, error: error);
      case JsonReply(:final status, :final body, :final headers):
        return ResponseBody.fromString(
          body == null ? '' : jsonEncode(body),
          status,
          headers: {
            Headers.contentTypeHeader: ['application/json; charset=utf-8'],
            for (final h in headers.entries) h.key.toLowerCase(): [h.value],
          },
        );
      case RawReply(:final status, :final text, :final contentType):
        return ResponseBody.fromString(
          text,
          status,
          headers: {
            Headers.contentTypeHeader: [contentType],
          },
        );
    }
  }

  @override
  void close({bool force = false}) {}
}

class FixedToken implements AccessTokenSource {
  FixedToken(this.token);
  String? token;
  @override
  Future<String?> currentAccessToken() async => token;
}

class FakeNetwork implements DeviceNetwork {
  FakeNetwork({this.online = true});
  bool online;
  final _controller = StreamController<bool>.broadcast();
  @override
  Future<bool> hasNetwork() async => online;
  @override
  Stream<bool> get changes => _controller.stream;
  void set(bool value) {
    online = value;
    _controller.add(value);
  }
}

/// A test harness around the real HTTP stack.
class Harness {
  Harness(
    List<FakeReply> replies, {
    String? token,
    bool online = true,
    AtlasEnvironmentConfig? config,
    this.clockStep = Duration.zero,
  }) : adapter = FakeAdapter(replies),
       tokens = FixedToken(token),
       network = FakeNetwork(online: online),
       reachability = ApiReachability() {
    final cfg = config ?? AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: 'http://api.test');
    dio = buildAtlasDio(
      config: cfg,
      tokens: tokens,
      reachability: reachability,
      adapter: adapter,
      sleep: (d) async {
        sleeps.add(d);
        now += d;
      },
      monotonicNow: () {
        now += clockStep;
        return now;
      },
    );
    client = AtlasApiClient(dio: dio, network: network);
  }

  final FakeAdapter adapter;
  final FixedToken tokens;
  final FakeNetwork network;
  final ApiReachability reachability;
  final Duration clockStep;
  final sleeps = <Duration>[];
  Duration now = Duration.zero;
  late final Dio dio;
  late final AtlasApiClient client;

  List<SentRequest> get sent => adapter.sent;
}

Map<String, Object?> errorBody(String code, {String error = 'Xato', String? requestId = 'req-1', Object? details}) => {
  'error': error,
  'code': code,
  'requestId': ?requestId,
  'details': ?details,
};
