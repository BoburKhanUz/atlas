import 'dart:async';

import 'package:atlas_mobile/features/legal/consent_gate.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  late SessionHarness h;
  late StreamController<void> refusals;

  setUp(() {
    h = SessionHarness(stored: pair(1));
    h.backend.script(P.logout, [
      JsonReply(200, {'ok': true}),
    ]);
    refusals = StreamController<void>.broadcast();
  });
  tearDown(() => refusals.close());

  ConsentGate gate(Future<bool> Function() consentRequired, {Duration timeout = const Duration(seconds: 6)}) {
    final g = ConsentGate(
      session: h.session,
      consentRequired: consentRequired,
      refusals: refusals.stream,
      checkTimeout: timeout,
    );
    addTearDown(g.dispose);
    return g;
  }

  test('signed out → none; a fresh sign-in waits for the check: required or not', () async {
    for (final answer in [true, false]) {
      h = SessionHarness();
      h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
      var asked = 0;
      final g = gate(() async {
        asked++;
        return answer;
      });
      expect(g.status, ConsentStatus.none);
      await h.session.login(email: 'a@test.local', password: 'pw');
      expect(g.status, ConsentStatus.checking);
      await pumpEventQueue();
      expect(g.status, answer ? ConsentStatus.required : ConsentStatus.notRequired);
      expect(asked, 1);
    }
  });

  test('a restored session goes straight in; the check runs in the background', () async {
    for (final answer in [true, false]) {
      h = SessionHarness(stored: pair(1));
      final server = Completer<bool>();
      final g = gate(() => server.future);
      await h.session.restore();
      expect(g.status, ConsentStatus.notRequired, reason: 'no splash wait on a cold start');
      server.complete(answer);
      await pumpEventQueue();
      expect(g.status, answer ? ConsentStatus.required : ConsentStatus.notRequired);
    }
  });

  test('a failed or slow check lets the user in (the server still refuses until accepted)', () async {
    final failing = gate(() async => throw StateError('offline'));
    await h.session.restore();
    await pumpEventQueue();
    expect(failing.status, ConsentStatus.notRequired);

    h = SessionHarness(stored: pair(1));
    final slow = gate(() => Completer<bool>().future, timeout: const Duration(milliseconds: 10));
    await h.session.restore();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(slow.status, ConsentStatus.notRequired);
  });

  test('a CONSENT_REQUIRED answer while signed in turns the gate on; accepting turns it off', () async {
    final g = gate(() async => false);
    refusals.add(null);
    await pumpEventQueue();
    expect(g.status, ConsentStatus.none, reason: 'no user: nothing to ask');

    await h.session.restore();
    await pumpEventQueue();
    expect(g.status, ConsentStatus.notRequired);
    refusals.add(null);
    await pumpEventQueue();
    expect(g.status, ConsentStatus.required);
    g.markAccepted();
    expect(g.status, ConsentStatus.notRequired);
  });

  test('signing out resets it; an answer that arrives after sign-out is ignored', () async {
    h = SessionHarness();
    h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
    h.backend.script(P.logout, [
      JsonReply(200, {'ok': true}),
    ]);
    final answer = Completer<bool>();
    final g = gate(() => answer.future);
    await h.session.login(email: 'a@test.local', password: 'pw');
    expect(g.status, ConsentStatus.checking);
    await h.session.logout();
    expect(g.status, ConsentStatus.none);
    answer.complete(true);
    await pumpEventQueue();
    expect(g.status, ConsentStatus.none);
  });
}
