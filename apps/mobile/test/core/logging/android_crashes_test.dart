import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart'
    show ClientErrorReport, ClientErrorReportKindEnum, ClientErrorReportPlatformEnum;
import 'package:atlas_mobile/core/logging/android_crashes.dart';
import 'package:atlas_mobile/core/logging/crash_reporter.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Protocol buffers encoding, enough to build test tombstones
/// (system/core/debuggerd/proto/tombstone.proto).
class _Pb {
  final _out = BytesBuilder();

  void _varint(int v) {
    var x = v;
    while (x >>> 7 != 0) {
      _out.addByte((x & 0x7f) | 0x80);
      x = x >>> 7;
    }
    _out.addByte(x);
  }

  _Pb uint(int field, int value) {
    _varint(field << 3);
    _varint(value);
    return this;
  }

  _Pb bytes(int field, List<int> value) {
    _varint(field << 3 | 2);
    _varint(value.length);
    _out.add(value);
    return this;
  }

  _Pb str(int field, String value) => bytes(field, utf8.encode(value));

  _Pb msg(int field, _Pb message) => bytes(field, message.build());

  Uint8List build() => _out.toBytes();
}

_Pb _frame(int relPc, String file, {String? function, int offset = 0, int mapOffset = 0, String? buildId}) {
  final f = _Pb().uint(1, relPc).uint(2, relPc + 0x7b00000000).uint(3, 0x7fe1c19000).str(6, file);
  if (function != null) f.str(4, function).uint(5, offset);
  if (mapOffset != 0) f.uint(7, mapOffset);
  if (buildId != null) f.str(8, buildId);
  return f;
}

_Pb _thread(int id, String name, List<_Pb> frames, {bool memory = false}) {
  final t = _Pb().uint(1, id).str(2, name).msg(3, _Pb().str(1, 'x28').uint(2, 0x5a5a5a5a));
  for (final f in frames) {
    t.msg(4, f);
  }
  // Memory near a register: raw process memory, which must never be read.
  if (memory) t.msg(5, _Pb().str(1, 'x0').uint(3, 0x7b00000000).str(4, 'refresh=secret-memory-contents'));
  return t;
}

final _token = 'Zk3J9xQ0-' * 5;

/// A SIGSEGV on the Flutter UI thread of an arm64 phone, with everything a
/// real tombstone carries around it.
Uint8List _segv() => _Pb()
    .uint(1, 1) // ARM64
    .str(2, 'google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys')
    .uint(5, 4321)
    .uint(6, 4350)
    .uint(7, 10234)
    .str(9, 'uz.atlas.app')
    .msg(10, _Pb().uint(1, 11).str(2, 'SIGSEGV').uint(3, 1).str(4, 'SEGV_MAPERR').uint(8, 1).uint(9, 0))
    .msg(15, _Pb().str(1, 'null pointer dereference'))
    .msg(
      16,
      _Pb()
          .uint(1, 4321)
          .msg(
            2,
            _thread(4321, 'uz.atlas.app', [
              _frame(0x9e2f4, '/apex/com.android.runtime/lib64/bionic/libc.so', function: '__epoll_pwait', offset: 4),
            ]),
          ),
    )
    .msg(
      16,
      _Pb()
          .uint(1, 4350)
          .msg(
            2,
            _thread(4350, '1.ui', [
              _frame(
                0x4ca1c,
                '/apex/com.android.runtime/lib64/bionic/libc.so',
                function: 'abort',
                offset: 168,
                buildId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
              ),
              _frame(
                0x16a3d4c,
                '/data/app/~~Qe1x8AbCdEfG==/uz.atlas.app-Zt3k9BhIjKlM==/base.apk!libflutter.so',
                mapOffset: 0x5f8000,
              ),
              _frame(
                0x2c8a74,
                '/apex/com.android.art/lib64/libart.so',
                function:
                    'art::ArtMethod::Invoke(art::Thread*, unsigned int*, unsigned int, art::JValue*, char const*)',
                offset: 212,
              ),
            ], memory: true),
          ),
    )
    .msg(17, _Pb().uint(1, 0x7b00000000).str(7, '/data/data/uz.atlas.app/files/private.db'))
    .msg(18, _Pb().str(1, 'main').msg(2, _Pb().str(5, 'flutter').str(6, 'signed in as ali@example.uz with $_token')))
    .msg(19, _Pb().uint(1, 87).str(2, '/data/user/0/uz.atlas.app/cache/image_picker_4711.jpg'))
    .build();

const _anrTrace = '''
Subject: Input dispatching timed out (8e3d0ad uz.atlas.app/uz.atlas.app.MainActivity (server) is not responding. Waited 5001ms for MotionEvent)
RssHwmKb: 239024
RssKb: 226432

--- CriticalEventLog ---
capacity: 20
events <
  timestamp_ms: 1760000000000
  anr <
    pid: 1111
    process: "com.other.app"
    subject: "Broadcast of Intent"
  >
>

----- pid 4321 at 2026-10-17 10:00:00.123456789+0500 -----
Cmd line: uz.atlas.app
Build fingerprint: 'google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys'
ABI: 'arm64'

DALVIK THREADS (3):
"main" prio=5 tid=1 Blocked
  | group="main" sCount=1 ucsCount=0 flags=1 obj=0x72a1b2c8 self=0xb400007a2c27c380
  | sysTid=4321 nice=-10 cgrp=top-app sched=0/0 handle=0x7b5b8f84f8
  | state=S schedstat=( 1530712394 280913459 1350 ) utm=126 stm=26 core=6 HZ=100
  | stack=0x7fe1c19000-0x7fe1c1b000 stackSize=8188KB
  | held mutexes=
  at uz.atlas.app.SomePlugin.read(SomePlugin.kt:42)
  - waiting to lock <0x0e2c3a7b> (a java.lang.Object) held by thread 12
  native: #00 pc 000000000009e2f4  /apex/com.android.runtime/lib64/bionic/libc.so (syscall+28) (BuildId: 4e4f0b3c2a1d9e8f7a6b5c4d3e2f1a0b)
  native: #01 pc 0000000000f1a2b4  /data/app/~~Qe1x8AbCdEfG==/uz.atlas.app-Zt3k9BhIjKlM==/base.apk (offset 0x5f8000)
  at android.os.Looper.loop(Looper.java:288)

"Signal Catcher" daemon prio=10 tid=4 Runnable
  | group="system" sCount=0 ucsCount=0 flags=0 obj=0x13b40270 self=0xb400007a2c2a5000
  native: #00 pc 000000000004e4d0  /apex/com.android.art/lib64/libart.so (art::DumpNativeStack+100)

----- end 4321 -----

----- pid 1000 at 2026-10-17 10:00:01.000000000+0500 -----
Cmd line: system_server

DALVIK THREADS (200):
"main" prio=5 tid=1 Native
  at com.android.server.SystemServer.run(SystemServer.java:900)
''';

String _javaTrace() => [
  'java.lang.RuntimeException: Unable to start activity ComponentInfo{uz.atlas.app/uz.atlas.app.MainActivity}: '
      'java.lang.IllegalStateException: no camera',
  'while signed in as ali@example.uz',
  for (var i = 0; i < 15; i++) '\tat android.app.ActivityThread.frame$i(ActivityThread.java:${3700 + i})',
  'Caused by: java.lang.IllegalStateException: no camera',
  '\tat io.flutter.plugins.camera.Camera.open(Camera.java:120)',
  '\t... 12 more',
].join('\n');

/// What the Kotlin side would hand over, with fakes for the system calls.
class _FakeRecords implements AndroidCrashRecords {
  _FakeRecords(this.crashes, {this.failPending = false});
  final List<AndroidCrash> crashes;
  final bool failPending;
  final acknowledged = <String>[];

  @override
  Future<List<AndroidCrash>> pending() async {
    if (failPending) throw PlatformException(code: 'error');
    return List.unmodifiable(crashes);
  }

  @override
  Future<void> acknowledge(Iterable<String> ids) async => acknowledged.addAll(ids);
}

AndroidCrash _crash(String id, int minute, {String? version, String message = 'boom'}) => AndroidCrash(
  id: id,
  kind: ClientErrorReportKindEnum.androidJava,
  occurredAt: DateTime.utc(2026, 10, 17, 9, minute),
  appVersion: version,
  errorType: 'java.lang.IllegalStateException',
  message: message,
  stack: '\tat uz.atlas.app.MainActivity.onCreate(MainActivity.kt:12)',
);

DioException _httpFailure(int status) => DioException(
  requestOptions: RequestOptions(path: '/api/v1/client-errors'),
  response: Response(
    requestOptions: RequestOptions(path: '/api/v1/client-errors'),
    statusCode: status,
  ),
  type: DioExceptionType.badResponse,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Java/Kotlin crashes', () {
    test('type, the whole message, frames per section and the causes', () {
      final parts = parseJavaCrash(_javaTrace());
      expect(parts.errorType, 'java.lang.RuntimeException');
      expect(
        parts.message,
        'Unable to start activity ComponentInfo{uz.atlas.app/uz.atlas.app.MainActivity}: '
        'java.lang.IllegalStateException: no camera\nwhile signed in as ali@example.uz',
      );
      final lines = parts.stack!.split('\n');
      expect(lines.where((l) => l.contains('ActivityThread.frame')), hasLength(12));
      expect(lines.sublist(12), [
        '\t... 3 frames omitted',
        'Caused by: java.lang.IllegalStateException: no camera',
        '\tat io.flutter.plugins.camera.Camera.open(Camera.java:120)',
        '\t... 12 more',
      ]);
    });

    test('a type without message or frames', () {
      expect(parseJavaCrash('java.lang.OutOfMemoryError'), (
        errorType: 'java.lang.OutOfMemoryError',
        message: '',
        stack: null,
      ));
      expect(parseJavaCrash('').errorType, 'Throwable');
    });
  });

  group('native crashes', () {
    test('signal, cause and the crashing thread from a tombstone; nothing else of it', () {
      final parts = parseNativeCrash(_segv(), status: 11);
      expect(parts.errorType, 'SIGSEGV');
      expect(
        parts.message,
        'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000000\nCause: null pointer dereference',
      );
      expect(parts.stack!.split('\n'), [
        'thread: 1.ui',
        '#00 pc 000000000004ca1c  libc.so (abort+168)',
        '#01 pc 00000000016a3d4c  base.apk!libflutter.so (offset 0x5f8000)',
        '#02 pc 00000000002c8a74  libart.so (art::ArtMethod::Invoke(art::Thread*, unsigned int*, unsigned int, art::JValue*, char const*)+212)',
      ]);
      final all = '${parts.message}\n${parts.stack}';
      for (final hidden in [
        'panther',
        '10234',
        '4321',
        'Qe1x8A',
        'Zt3k9B',
        'a1b2c3d4',
        'secret-memory',
        'private.db',
        'ali@example.uz',
        _token,
        'image_picker',
        '__epoll_pwait',
        'x28',
        '5a5a5a5a',
      ]) {
        expect(all, isNot(contains(hidden)), reason: hidden);
      }
    });

    test('an abort on a 32-bit phone: negative signal code, no fault address, the abort message', () {
      final tombstone = _Pb()
          .uint(6, 99)
          .msg(10, _Pb().uint(1, 6).str(2, 'SIGABRT').uint(3, -6).str(4, 'SI_TKILL'))
          .str(14, '[FATAL:flutter/shell/common/shell.cc(120)] Check failed: task_runners_.IsValid().')
          .msg(
            16,
            _Pb()
                .uint(1, 99)
                .msg(2, _thread(99, 'main', [_frame(0x5e6c8, '/system/lib/libc.so', function: 'abort', offset: 172)])),
          )
          .build();
      final parts = parseNativeCrash(tombstone);
      expect(parts.errorType, 'SIGABRT');
      expect(
        parts.message,
        'signal 6 (SIGABRT), code -6 (SI_TKILL), fault addr --------\n'
        "Abort message: '[FATAL:flutter/shell/common/shell.cc(120)] Check failed: task_runners_.IsValid().'",
      );
      expect(parts.stack, 'thread: main\n#00 pc 0005e6c8  libc.so (abort+172)');
    });

    test('a tagged fault address keeps all 64 bits', () {
      final tagged = (0xb400007a << 32) | 0x2c27c380;
      final tombstone = _Pb()
          .uint(1, 1)
          .msg(10, _Pb().uint(1, 11).str(2, 'SIGSEGV').uint(3, 2).str(4, 'SEGV_ACCERR').uint(8, 1).uint(9, tagged))
          .build();
      expect(
        parseNativeCrash(tombstone).message,
        'signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0xb400007a2c27c380',
      );
    });

    test('a truncated or damaged tombstone gives what it has and never throws', () {
      final full = _segv();
      for (var cut = 0; cut < full.length; cut += 7) {
        final parts = parseNativeCrash(Uint8List.sublistView(full, 0, cut), status: 11);
        expect(parts.errorType, 'SIGSEGV', reason: 'cut at $cut');
      }
      final noise = Uint8List.fromList(List.generate(4096, (i) => (i * 7919 + 13) & 0xff));
      expect(parseNativeCrash(noise, status: 6).errorType, isNotEmpty);
    });

    test('bytes that are not a tombstone (an ANR trace, a broken signal) fall back to the exit status', () {
      expect(parseNativeCrash(Uint8List.fromList(utf8.encode(_anrTrace)), status: 11).errorType, 'SIGSEGV');
      final noSignal = _Pb().msg(10, _Pb().uint(1, 900).str(2, 'SIGSEGV')).build();
      expect(parseNativeCrash(noSignal, status: 6), (errorType: 'SIGABRT', message: 'signal 6 (SIGABRT)', stack: null));
      final oddName = _Pb().msg(10, _Pb().uint(1, 11).str(2, 'x\u0000y')).build();
      expect(parseNativeCrash(oddName).errorType, 'SIGSEGV');
    });

    test('Android 11 (no tombstone): the signal number, else the system description', () {
      expect(parseNativeCrash(null, status: 11), (errorType: 'SIGSEGV', message: 'signal 11 (SIGSEGV)', stack: null));
      expect(parseNativeCrash(null, description: 'crash'), (errorType: 'native crash', message: 'crash', stack: null));
    });
  });

  group('ANRs', () {
    final trace = Uint8List.fromList(utf8.encode(_anrTrace));

    test('the reason and the main thread of the app only', () {
      final parts = parseAnr(trace, description: 'user request after error: Input dispatching timed out');
      expect(parts.errorType, 'ANR');
      expect(parts.message, 'user request after error: Input dispatching timed out');
      expect(parts.stack!.split('\n'), [
        '"main" prio=5 tid=1 Blocked',
        'at uz.atlas.app.SomePlugin.read(SomePlugin.kt:42)',
        '- waiting to lock <0x0e2c3a7b> (a java.lang.Object) held by thread 12',
        'native: #00 pc 000000000009e2f4  libc.so (syscall+28)',
        'native: #01 pc 0000000000f1a2b4  base.apk (offset 0x5f8000)',
        'at android.os.Looper.loop(Looper.java:288)',
      ]);
      for (final hidden in [
        'com.other.app',
        'Signal Catcher',
        'system_server',
        'panther',
        'self=',
        'RssKb',
        'Qe1x8A',
      ]) {
        expect(parts.stack, isNot(contains(hidden)), reason: hidden);
      }
    });

    test('without a description the trace subject; without a trace no stack', () {
      expect(parseAnr(trace).message, startsWith('Input dispatching timed out (8e3d0ad uz.atlas.app/'));
      expect(parseAnr(null), (errorType: 'ANR', message: '', stack: null));
    });
  });

  group('records of the Android side', () {
    test('each kind, with the version that crashed', () {
      final java = AndroidCrash.fromRecord({
        'id': 'java-1760691600000.json',
        'kind': 'java',
        'time': 1760691600000,
        'version': '0.1.0+1',
        'trace': _javaTrace(),
      })!;
      expect(
        [java.id, java.kind, java.occurredAt, java.appVersion, java.errorType],
        [
          'java-1760691600000.json',
          ClientErrorReportKindEnum.androidJava,
          DateTime.fromMillisecondsSinceEpoch(1760691600000, isUtc: true),
          '0.1.0+1',
          'java.lang.RuntimeException',
        ],
      );
      final native = AndroidCrash.fromRecord({
        'id': 'exit-1760691700000',
        'kind': 'native',
        'time': 1760691700000,
        'version': '',
        'status': 11,
        'description': ' ',
        'trace': _segv(),
      })!;
      expect(
        [native.kind, native.appVersion, native.errorType],
        [ClientErrorReportKindEnum.androidNative, null, 'SIGSEGV'],
      );
      final anr = AndroidCrash.fromRecord({
        'id': 'exit-1760691800000',
        'kind': 'anr',
        'time': 1760691800000,
        'description': 'bg anr: Broadcast of Intent',
        'trace': null,
      })!;
      expect(
        [anr.kind, anr.message, anr.stack],
        [ClientErrorReportKindEnum.androidAnr, 'bg anr: Broadcast of Intent', null],
      );
    });

    test('a record it cannot read is skipped', () {
      expect(AndroidCrash.fromRecord({'kind': 'java', 'time': 1}), isNull);
      expect(AndroidCrash.fromRecord({'id': 'x', 'kind': 'java'}), isNull);
      expect(AndroidCrash.fromRecord({'id': 'x', 'kind': 'oom', 'time': 1}), isNull);
    });

    test('the method channel: pending records and acknowledged ids', () async {
      const channel = MethodChannel('uz.atlas.app/crash_records');
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return switch (call.method) {
          'pending' => [
            {'id': 'exit-1', 'kind': 'native', 'time': 1, 'status': 6, 'trace': null},
            {'id': 'x', 'kind': 'unknown', 'time': 2},
          ],
          _ => null,
        };
      });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null),
      );
      const records = MethodChannelAndroidCrashRecords();
      expect((await records.pending()).map((c) => (c.id, c.errorType)), [('exit-1', 'SIGABRT')]);
      await records.acknowledge({'exit-1', 'java-2.json'});
      expect(calls.map((c) => [c.method, c.arguments]), [
        ['pending', null],
        [
          'acknowledge',
          ['exit-1', 'java-2.json'],
        ],
      ]);
    });

    test('the Android side writes Java crashes with the same scrubbing rules', () {
      final kotlin = File('android/app/src/main/kotlin/uz/atlas/app/CrashRecords.kt').readAsStringSync();
      final rules = RegExp(r'val SCRUB = listOf\((.*?)\n    \)', dotAll: true).firstMatch(kotlin)![1]!;
      expect(RegExp(r'Regex\("""(.*?)"""').allMatches(rules).map((m) => m[1]).toList(), ErrorScrub.patterns);
      // Bearer is matched in any case, as on the Dart side.
      expect(rules.split('\n').where((l) => l.contains('IGNORE_CASE')).single, contains('Bearer'));
    });
  });

  group('CrashReporter.reportAndroidCrashes', () {
    late List<List<ClientErrorReport>> batches;
    late Object? failure;
    late CrashReporter reporter;

    setUp(() {
      batches = [];
      failure = null;
      reporter = CrashReporter(
        send: (reports) async {
          if (failure case final Object f) throw f;
          batches.add(reports);
        },
        appVersion: '0.1.1+2',
        platform: ClientErrorReportPlatformEnum.android,
        osVersion: 'android 14',
      )..currentRoute = () => '/wardrobe';
    });

    test('the oldest 10 at once, as fatal reports of the version that crashed; then acknowledged', () async {
      final records = _FakeRecords([
        for (var i = 11; i >= 0; i--) _crash('java-$i.json', i, version: i == 0 ? '0.1.0+1' : null),
      ]);
      await reporter.reportAndroidCrashes(records);
      final sent = batches.single;
      expect(sent.map((r) => r.occurredAt), [for (var i = 0; i < 10; i++) DateTime.utc(2026, 10, 17, 9, i)]);
      expect(records.acknowledged, [for (var i = 0; i < 10; i++) 'java-$i.json']);
      final first = sent.first;
      expect(
        [first.kind, first.fatal, first.appVersion, first.osVersion, first.route, first.errorType],
        [ClientErrorReportKindEnum.androidJava, true, '0.1.0+1', 'android 14', null, 'java.lang.IllegalStateException'],
      );
      // A record without a version: the running one.
      expect(sent[1].appVersion, '0.1.1+2');
    });

    test('scrubbed like every report', () async {
      await reporter.reportAndroidCrashes(
        _FakeRecords([_crash('java-1.json', 1, message: 'for ali@example.uz token $_token')]),
      );
      expect(batches.single.single.message, 'for [REDACTED_EMAIL] token [REDACTED]');
    });

    test('offline or a server error: kept for the next start; refused content: dropped', () async {
      for (final (error, dropped) in [
        (DioException.connectionError(requestOptions: RequestOptions(), reason: 'offline'), false),
        (_httpFailure(429), false),
        (_httpFailure(503), false),
        (StateError('unexpected'), false),
        (_httpFailure(400), true),
        (_httpFailure(413), true),
      ]) {
        failure = error;
        final records = _FakeRecords([_crash('java-1.json', 1)]);
        await expectLater(reporter.reportAndroidCrashes(records), completes);
        expect(records.acknowledged, dropped ? ['java-1.json'] : isEmpty, reason: '$error');
      }
    });

    test('nothing pending, or the Android side failing, sends nothing and never throws', () async {
      await reporter.reportAndroidCrashes(_FakeRecords([]));
      await expectLater(reporter.reportAndroidCrashes(_FakeRecords([], failPending: true)), completes);
      expect(batches, isEmpty);
    });
  });
}
