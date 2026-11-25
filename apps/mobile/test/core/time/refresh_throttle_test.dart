import 'dart:async';

import 'package:atlas_mobile/core/time/refresh_throttle.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Duration now;
  late List<(Duration, Completer<void>)> waits;
  late int runs;
  late int laters;
  late RefreshThrottle throttle;

  Future<void> action() async => runs++;
  void later() => laters++;

  setUp(() {
    now = Duration.zero;
    waits = [];
    runs = 0;
    laters = 0;
    throttle = RefreshThrottle(
      interval: const Duration(seconds: 30),
      now: () => now,
      delay: (d) {
        final done = Completer<void>();
        waits.add((d, done));
        return done.future;
      },
    );
  });

  test('callers asking while one runs share it', () async {
    final gate = Completer<void>();
    var started = 0;
    Future<void> slow() async {
      started++;
      await gate.future;
    }

    final a = throttle.run(slow, later: later);
    final b = throttle.run(slow, later: later);
    expect(throttle.running, isTrue);
    gate.complete();
    await Future.wait([a, b]);
    expect(started, 1);
    expect(throttle.running, isFalse);
  });

  test('a request inside the interval is deferred once to its end, not dropped', () async {
    await throttle.run(action, later: later);
    now += const Duration(seconds: 10);
    await throttle.run(action, later: later);
    await throttle.run(action, later: later);
    expect(runs, 1);
    expect(waits.single.$1, const Duration(seconds: 20));
    waits.single.$2.complete();
    await pumpEventQueue();
    expect(laters, 1);
  });

  test('after the interval it runs at once; force skips the interval', () async {
    await throttle.run(action, later: later);
    await throttle.run(action, later: later, force: true);
    expect(runs, 2);
    now += const Duration(seconds: 30);
    await throttle.run(action, later: later);
    expect(runs, 3);
    expect(waits, isEmpty);
  });

  test('the interval counts from the end of the run, also when it fails', () async {
    await expectLater(throttle.run(() async => throw StateError('failed'), later: later), throwsStateError);
    await throttle.run(action, later: later);
    expect(runs, 0, reason: 'a failing reload is not repeated at once');
    expect(waits, hasLength(1));
  });

  test('no deferred call after dispose', () async {
    await throttle.run(action, later: later);
    await throttle.run(action, later: later);
    throttle.dispose();
    waits.single.$2.complete();
    await pumpEventQueue();
    expect(laters, 0);
  });

  test(
    'fresh URLs that keep failing back off (30 s, 60 s, 120 s … at most 10 min); a quiet interval resets it',
    () async {
      Future<void> reportSoonAndWait(Duration expected) async {
        now += const Duration(seconds: 1); // the fresh URL failed right away
        await throttle.run(action, later: later);
        final (wait, done) = waits.removeLast();
        expect(wait, expected - const Duration(seconds: 1));
        now += wait;
        done.complete();
        await pumpEventQueue();
        await throttle.run(action, later: later); // what [later] does
      }

      await throttle.run(action, later: later);
      await reportSoonAndWait(const Duration(seconds: 30));
      await reportSoonAndWait(const Duration(seconds: 60));
      await reportSoonAndWait(const Duration(seconds: 120));
      for (var i = 0; i < 6; i++) {
        now += const Duration(seconds: 1);
        await throttle.run(action, later: later);
        final (wait, done) = waits.removeLast();
        now += wait;
        done.complete();
        await pumpEventQueue();
        await throttle.run(action, later: later);
      }
      now += const Duration(seconds: 1);
      await throttle.run(action, later: later);
      final (capped, cappedDone) = waits.removeLast();
      expect(capped, const Duration(minutes: 10) - const Duration(seconds: 1), reason: 'capped');
      cappedDone.complete();
      await pumpEventQueue();
      // The URLs then work for a whole interval: back to 30 s.
      final runsBefore = runs;
      now += const Duration(minutes: 11);
      await throttle.run(action, later: later);
      expect(runs, runsBefore + 1);
      now += const Duration(minutes: 11);
      await throttle.run(action, later: later);
      now += const Duration(seconds: 1);
      await throttle.run(action, later: later);
      expect(waits.removeLast().$1, const Duration(seconds: 29));
    },
  );
}
