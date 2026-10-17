import 'dart:convert';

import 'package:atlas_api/atlas_api.dart'
    show ClientErrorReport, ClientErrorReportKindEnum, ClientErrorReportPlatformEnum;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/crash_reporter.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  // Token-shaped values are assembled at runtime (no such literal in the source).
  final jwt = ['eyJ${'a' * 12}', 'b' * 12, 'c' * 12].join('.');
  final opaque = 'kq3J9xZ0-' * 5;

  group('ErrorScrub', () {
    test('drops e-mail, Bearer, JWT, URL queries and opaque tokens; keeps stack paths', () {
      final out = ErrorScrub.text(
        'for ali@example.uz Bearer $opaque $jwt at https://a.uz/api/v1/media/x.webp?exp=1&sig=s token $opaque '
        '(package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart:42:7)',
      );
      for (final secret in ['ali@example.uz', opaque, jwt, 'sig=s']) {
        expect(out, isNot(contains(secret)), reason: secret);
      }
      expect(out, contains('https://a.uz/api/v1/media/x.webp?[REDACTED]'));
      expect(out, contains('package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart:42:7'));
    });

    test('ids in routes become :id', () {
      expect(ErrorScrub.route('/wardrobe/item/cm9x8y7z6w5v4u3t2s1r?x=1'), '/wardrobe/item/:id');
      expect(ErrorScrub.route('/legal/privacy'), '/legal/privacy');
    });
  });

  group('CrashReporter', () {
    late List<List<ClientErrorReport>> batches;
    late CrashReporter reporter;

    setUp(() {
      batches = [];
      reporter = CrashReporter(
        send: (reports) async => batches.add(reports),
        appVersion: '0.1.0+1',
        platform: ClientErrorReportPlatformEnum.android,
        osVersion: 'android 14',
        clock: () => DateTime.utc(2026, 10, 17, 9),
      )..currentRoute = () => '/stylist/chat/cmabcdefghijklmnop12';
    });

    test('one scrubbed report with the app version, platform, kind and route', () async {
      reporter.record(
        StateError('no item for ali@example.uz'),
        StackTrace.current,
        kind: ClientErrorReportKindEnum.dart,
        fatal: true,
      );
      await reporter.flush();
      expect(batches, hasLength(1));
      final r = batches.single.single;
      expect(r.platform, ClientErrorReportPlatformEnum.android);
      expect(
        [r.appVersion, r.osVersion, r.errorType, r.route],
        ['0.1.0+1', 'android 14', 'StateError', '/stylist/chat/:id'],
      );
      expect([r.kind, r.fatal], [ClientErrorReportKindEnum.dart, true]);
      expect(r.message, 'Bad state: no item for [REDACTED_EMAIL]');
      expect(r.stack, contains('crash_reporter_test.dart'));
      expect(r.occurredAt, DateTime.utc(2026, 10, 17, 9));
    });

    test('each distinct error once, at most 20 per run, in batches of 10', () async {
      final same = StateError('same');
      final stack = StackTrace.current;
      for (var i = 0; i < 5; i++) {
        reporter.record(same, stack, kind: ClientErrorReportKindEnum.dart);
      }
      for (var i = 0; i < 30; i++) {
        reporter.record(StateError('error $i'), stack, kind: ClientErrorReportKindEnum.dart);
      }
      await reporter.flush();
      expect(batches.map((b) => b.length), [10, 10]);
      expect(batches.expand((b) => b).where((r) => r.message == 'Bad state: same'), hasLength(1));
    });

    test('a failing send is dropped silently and reports nothing about itself', () async {
      final failing = CrashReporter(
        send: (_) async => throw StateError('offline'),
        appVersion: '1',
        platform: ClientErrorReportPlatformEnum.ios,
      );
      failing.record(StateError('x'), null, kind: ClientErrorReportKindEnum.flutter);
      await expectLater(failing.flush(), completes);
      await expectLater(failing.flush(), completes);
    });

    test('sends on its own after the flush delay', () async {
      final quick = CrashReporter(
        send: (reports) async => batches.add(reports),
        appVersion: '1',
        platform: ClientErrorReportPlatformEnum.android,
        flushDelay: const Duration(milliseconds: 10),
      );
      quick.record(StateError('later'), null, kind: ClientErrorReportKindEnum.dart);
      expect(batches, isEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(batches.single.single.message, 'Bad state: later');
    });

    test('install(): framework errors keep their presentation and are recorded; uncaught async errors too', () async {
      final savedFlutter = FlutterError.onError;
      final savedPlatform = PlatformDispatcher.instance.onError;
      final presented = <FlutterErrorDetails>[];
      FlutterError.onError = presented.add;
      try {
        reporter.install();
        FlutterError.reportError(FlutterErrorDetails(exception: StateError('layout'), stack: StackTrace.current));
        expect(PlatformDispatcher.instance.onError!(StateError('async'), StackTrace.current), isTrue);
      } finally {
        FlutterError.onError = savedFlutter;
        PlatformDispatcher.instance.onError = savedPlatform;
      }
      expect(presented, hasLength(1));
      await reporter.flush();
      expect(batches.single.map((r) => (r.kind, r.message, r.fatal)), [
        (ClientErrorReportKindEnum.flutter, 'Bad state: layout', false),
        (ClientErrorReportKindEnum.dart, 'Bad state: async', true),
      ]);
    });
  });

  test('httpErrorReportSender posts the contract body to /api/v1/client-errors without any session header', () async {
    final backend = FakeBackend()
      ..script('/api/v1/client-errors', [
        JsonReply(200, {'ok': true}),
      ]);
    final config = AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: 'http://api.test');
    final reporter = CrashReporter(
      send: httpErrorReportSender(config, adapter: backend),
      appVersion: '0.1.0+1',
      platform: ClientErrorReportPlatformEnum.android,
      clock: () => DateTime.utc(2026, 10, 17, 9),
    );
    reporter.record(StateError('boom'), null, kind: ClientErrorReportKindEnum.dart);
    await reporter.flush();
    final sent = backend.to('/api/v1/client-errors').single;
    expect(sent.header('Authorization'), isNull);
    expect(jsonDecode(sent.bodyText), {
      'reports': [
        {
          'platform': 'android',
          'appVersion': '0.1.0+1',
          'kind': 'dart',
          'fatal': false,
          'errorType': 'StateError',
          'message': 'Bad state: boom',
          'occurredAt': '2026-10-17T09:00:00.000Z',
        },
      ],
    });
  });
}
