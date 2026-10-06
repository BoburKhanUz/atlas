import 'dart:convert';

import 'package:atlas_mobile/features/stylist/data/stylist_repository.dart';
import 'package:atlas_mobile/features/stylist/presentation/chat_controller.dart';
import 'package:atlas_mobile/features/stylist/providers.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../outfits/outfit_fixtures.dart' show weatherJson, weatherUsedJson;
import 'stylist_fixtures.dart';

class Chat {
  Chat({this.key = newChatKey}) {
    c = ProviderContainer(overrides: [...appOverrides(h), weatherClockProvider.overrideWithValue(() => clock)]);
    addTearDown(c.dispose);
    h.backend.script(P.chat, [JsonReply(200, chatJson('c1'))]);
    h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.utc(2026, 10, 5, 10)))]);
    h.backend.handlers['${P.conversations}/c1'] = (_) => convReply;
    h.backend.script(P.conversations, [
      JsonReply(200, conversationsJson(const ['c1'])),
    ]);
  }

  final String key;
  final h = SessionHarness(stored: pair(1));
  late final ProviderContainer c;
  DateTime clock = DateTime.utc(2026, 10, 5, 10, 5);
  FakeReply convReply = JsonReply(
    200,
    conversationJson('c1', const [('user', 'Salom'), ('assistant', 'Assalomu alaykum!')]),
  );

  ChatController get ctl => c.read(chatControllerProvider(key).notifier);
  ChatState get state => c.read(chatControllerProvider(key));
  List<Map<String, Object?>> get bodies =>
      h.backend.to(P.chat).map((r) => jsonDecode(r.bodyText) as Map<String, Object?>).toList();

  Future<void> start() async {
    await h.session.restore();
    c.listen(chatControllerProvider(key), (_, _) {});
    for (var i = 0; i < 20 && state.status == ChatStatus.loading; i++) {
      await pumpEventQueue();
    }
  }
}

void main() {
  group('message validation (1–2000, trimmed)', () {
    test('rules', () {
      expect(StylistLimits.validMessage('  salom  '), 'salom');
      expect(StylistLimits.validMessage('   '), isNull);
      expect(StylistLimits.validMessage('a' * 2000), hasLength(2000));
      expect(StylistLimits.validMessage('a' * 2001), isNull);
      expect(StylistLimits.validMessage('  ${'a' * 2000}  '), hasLength(2000), reason: 'trimmed before counting');
    });

    test('invalid text is never sent', () async {
      final ch = Chat();
      await ch.start();
      expect(await ch.ctl.send('   '), SendResult.invalid);
      expect(await ch.ctl.send('a' * 2001), SendResult.invalid);
      expect(ch.h.backend.calls(P.chat), 0);
    });
  });

  group('send', () {
    test('new chat: one POST with the trimmed message; the answer and the new id are kept', () async {
      final ch = Chat();
      await ch.start();
      expect(await ch.ctl.send('  Bugun nima kiyay?  '), SendResult.sent);
      expect(ch.bodies, [
        {'message': 'Bugun nima kiyay?'},
      ]);
      expect(ch.state.conversationId, 'c1');
      expect(ch.state.messages.map((m) => (m.role, m.content)), [
        ('user', 'Bugun nima kiyay?'),
        ('assistant', 'Ko‘k shim va oq ko‘ylak mos keladi.'),
      ]);
      expect(ch.state.sent, 1);
      expect(ch.state.pending, isNull);
      expect(ch.state.summary!.wardrobeItemCount, 6);
    });

    test('the next message continues the same conversation', () async {
      final ch = Chat();
      await ch.start();
      await ch.ctl.send('Birinchi');
      await ch.ctl.send('Ikkinchi');
      expect(ch.bodies.map((b) => b['conversationId']), [null, 'c1']);
      expect(ch.state.messages, hasLength(4));
    });

    test('an existing conversation is loaded first and its id sent', () async {
      final ch = Chat(key: 'c1');
      await ch.start();
      expect(ch.state.messages.map((m) => m.content), ['Salom', 'Assalomu alaykum!']);
      await ch.ctl.send('Davom etamiz');
      expect(ch.bodies.single['conversationId'], 'c1');
      expect(ch.state.messages, hasLength(4));
    });

    test('the server answers with ANOTHER id (unknown/foreign id): switch to it, old messages not mixed in', () async {
      final ch = Chat(key: 'c1');
      ch.h.backend.script(P.chat, [JsonReply(200, chatJson('c9'))]);
      await ch.start();
      await ch.ctl.send('Salom');
      expect(ch.state.conversationId, 'c9');
      expect(ch.state.startedNewConversation, isTrue);
      expect(ch.state.messages.map((m) => m.content), ['Salom', 'Ko‘k shim va oq ko‘ylak mos keladi.']);
    });

    test('occasion is sent as event; weather only when FRESH', () async {
      final ch = Chat();
      await ch.start();
      await ch.c.read(weatherControllerProvider.notifier).chooseCity(Cities.all.first);
      await ch.ctl.send('Nima kiyay?', event: 'wedding');
      expect(ch.bodies.last, {'message': 'Nima kiyay?', 'event': 'wedding', 'weather': weatherUsedJson()});
      ch.clock = DateTime.utc(2026, 10, 5, 10, 30); // fetchedAt 10:00 + 30 min → stale
      await ch.ctl.send('Yana?');
      expect(ch.bodies.last.containsKey('weather'), isFalse, reason: 'stale weather is never sent');
    });

    test('double tap → one POST', () async {
      final ch = Chat();
      await ch.start();
      ch.h.backend.gates[P.chat] = Gate();
      final a = ch.ctl.send('Salom');
      final b = ch.ctl.send('Salom');
      await pumpEventQueue();
      ch.h.backend.gates[P.chat]!.open();
      expect(await Future.wait([a, b]), containsAll([SendResult.sent, SendResult.blocked]));
      expect(ch.h.backend.calls(P.chat), 1);
    });

    test('401 → refresh → the message is re-sent once with the new token', () async {
      final ch = Chat();
      await ch.start();
      ch.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      ch.h.backend.script(P.chat, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, chatJson('c1'))]);
      expect(await ch.ctl.send('Salom'), SendResult.sent);
      expect(ch.h.bearers(P.chat), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    });
  });

  group('failures', () {
    test('4xx → failed: nothing stored, no message added, nothing re-sent', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [JsonReply(400, errorBody('VALIDATION_ERROR'))]);
      await ch.start();
      expect(await ch.ctl.send('Salom'), SendResult.failed);
      expect(ch.state.send, SendStatus.failed);
      expect(ch.state.messages, isEmpty);
      expect(ch.state.sent, 0, reason: 'the composer keeps the draft');
      expect(ch.h.backend.calls(P.chat), 1);
      expect(ch.state.resendNeedsConfirmation, isFalse, reason: 'definitely not stored: sending again is safe');
    });

    for (final (name, reply) in [
      ('receive timeout', TransportFailure(DioExceptionType.receiveTimeout) as FakeReply),
      ('connection error', TransportFailure(DioExceptionType.connectionError)),
      ('5xx', JsonReply(500, errorBody('INTERNAL'))),
    ]) {
      test('$name → UNKNOWN: never re-sent automatically; the draft stays', () async {
        final ch = Chat();
        ch.h.backend.script(P.chat, [reply, JsonReply(200, chatJson('c1'))]);
        await ch.start();
        expect(await ch.ctl.send('Salom'), SendResult.unknown);
        expect(ch.state.send, SendStatus.unknown);
        expect(ch.state.sent, 0);
        expect(ch.h.backend.calls(P.chat), 1);
      });
    }

    test('after UNKNOWN, sending again needs explicit confirmation (may duplicate)', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [TransportFailure(DioExceptionType.receiveTimeout), JsonReply(200, chatJson('c1'))]);
      await ch.start();
      await ch.ctl.send('Salom');
      expect(await ch.ctl.send('Salom'), SendResult.needsConfirmation);
      expect(ch.h.backend.calls(P.chat), 1);
      expect(await ch.ctl.send('Salom', confirmResend: true), SendResult.sent);
      expect(ch.h.backend.calls(P.chat), 2);
      expect(ch.state.resendNeedsConfirmation, isFalse);
    });

    test(
      'refresh after UNKNOWN shows the SERVER transcript as is (no matching, no POST); confirmation still required',
      () async {
        final ch = Chat(key: 'c1');
        ch.h.backend.script(P.chat, [TransportFailure(DioExceptionType.receiveTimeout)]);
        await ch.start();
        await ch.ctl.send('Kecha nima kiydim?');
        ch.convReply = JsonReply(
          200,
          conversationJson('c1', const [
            ('user', 'Salom'),
            ('assistant', 'Assalomu alaykum!'),
            ('user', 'Kecha nima kiydim?'),
            ('assistant', 'Server javobi'),
          ]),
        );
        await ch.ctl.refresh();
        expect(ch.state.messages.map((m) => (m.role, m.content)), [
          ('user', 'Salom'),
          ('assistant', 'Assalomu alaykum!'),
          ('user', 'Kecha nima kiydim?'),
          ('assistant', 'Server javobi'),
        ], reason: 'the server transcript replaces the local one exactly (no merging, no matching)');
        expect(ch.state.send, SendStatus.idle);
        expect(ch.state.pending, isNull);
        expect(ch.state.resendNeedsConfirmation, isTrue);
        expect(ch.h.backend.calls(P.chat), 1);
      },
    );

    test('a terminal session error → failed, nothing re-sent', () async {
      final ch = Chat();
      ch.h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_REVOKED'))]);
      ch.h.backend.script(P.chat, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await ch.start();
      expect(await ch.ctl.send('Salom'), SendResult.failed);
      expect(ch.h.backend.calls(P.chat), 1);
    });
  });

  group('Phase 4.2: idempotency and AI errors', () {
    String? keyOf(Chat ch, int i) => ch.h.backend.to(P.chat)[i].header('Idempotency-Key') as String?;

    test('every explicit send carries its own Idempotency-Key', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [JsonReply(200, chatJson('c1')), JsonReply(200, chatJson('c1'))]);
      await ch.start();
      await ch.ctl.send('Birinchi');
      await ch.ctl.send('Ikkinchi');
      final a = keyOf(ch, 0), b = keyOf(ch, 1);
      expect(a, matches(RegExp(r'^[A-Za-z0-9_-]{8,128}$')));
      expect(b, isNot(a));
    });

    test('after UNKNOWN, a confirmed re-send of the same text repeats the exact request (same key and body)', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [TransportFailure(DioExceptionType.receiveTimeout), JsonReply(200, chatJson('c1'))]);
      await ch.start();
      await ch.c.read(weatherControllerProvider.notifier).chooseCity(Cities.all.first);
      expect(await ch.ctl.send('Salom', event: 'work'), SendResult.unknown);
      ch.clock = DateTime.utc(
        2026,
        10,
        5,
        10,
        40,
      ); // weather is stale by now: the repeat still carries the original snapshot
      expect(await ch.ctl.send('Salom', event: 'work', confirmResend: true), SendResult.sent);
      expect(keyOf(ch, 1), keyOf(ch, 0));
      expect(ch.bodies[1], ch.bodies[0]);
      expect(ch.state.messages.where((m) => m.fromUser), hasLength(1));
    });

    test('after UNKNOWN, a confirmed send of DIFFERENT text is a new request with a new key', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [TransportFailure(DioExceptionType.receiveTimeout), JsonReply(200, chatJson('c1'))]);
      await ch.start();
      await ch.ctl.send('Salom');
      expect(await ch.ctl.send('Boshqa savol', confirmResend: true), SendResult.sent);
      expect(keyOf(ch, 1), isNot(keyOf(ch, 0)));
    });

    test(
      '503 AI_UNAVAILABLE → failed (the server stored nothing): draft kept, no confirmation needed, new key next time',
      () async {
        final ch = Chat();
        ch.h.backend.script(P.chat, [
          JsonReply(503, errorBody('AI_UNAVAILABLE'), headers: {'Retry-After': '15'}),
          JsonReply(200, chatJson('c1')),
        ]);
        await ch.start();
        expect(await ch.ctl.send('Salom'), SendResult.failed);
        expect(ch.state.send, SendStatus.failed);
        expect(ch.state.failure!.userMessage, contains('AI xizmati hozir ishlamayapti'));
        expect(ch.state.resendNeedsConfirmation, isFalse);
        expect(ch.state.messages, isEmpty);
        expect(ch.h.backend.calls(P.chat), 1, reason: 'never retried automatically');
        expect(await ch.ctl.send('Salom'), SendResult.sent);
        expect(keyOf(ch, 1), isNot(keyOf(ch, 0)));
      },
    );

    test('429 AI_QUOTA_EXCEEDED → failed with the daily-limit message', () async {
      final ch = Chat();
      ch.h.backend.script(P.chat, [
        JsonReply(429, errorBody('AI_QUOTA_EXCEEDED'), headers: {'Retry-After': '3600'}),
      ]);
      await ch.start();
      expect(await ch.ctl.send('Salom'), SendResult.failed);
      expect(ch.state.failure!.userMessage, contains('limiti tugadi'));
      expect(ch.state.resendNeedsConfirmation, isFalse);
    });

    test('404 for the conversation → failed; the app does not switch conversations', () async {
      final ch = Chat(key: 'c1');
      ch.h.backend.script(P.chat, [JsonReply(404, errorBody('NOT_FOUND'))]);
      await ch.start();
      expect(await ch.ctl.send('Salom'), SendResult.failed);
      expect(ch.state.conversationId, 'c1');
      expect(ch.state.startedNewConversation, isFalse);
      expect(ch.state.messages.map((m) => m.content), ['Salom', 'Assalomu alaykum!']);
    });

    test(
      '409 IDEMPOTENCY_IN_PROGRESS is not a definite failure → unknown (the first attempt may still be stored)',
      () async {
        final ch = Chat();
        ch.h.backend.script(P.chat, [
          JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '5'}),
        ]);
        await ch.start();
        expect(await ch.ctl.send('Salom'), SendResult.unknown);
        expect(ch.state.resendNeedsConfirmation, isTrue);
      },
    );
  });

  group('loading', () {
    test('a missing conversation → notFound', () async {
      final ch = Chat(key: 'c1')..convReply = JsonReply(404, errorBody('NOT_FOUND'));
      await ch.start();
      expect(ch.state.status, ChatStatus.notFound);
      expect(await ch.ctl.send('Salom'), SendResult.blocked);
    });

    test('offline load → loadFailed → retry', () async {
      final ch = Chat(key: 'c1')..convReply = TransportFailure(DioExceptionType.connectionError);
      await ch.start();
      expect(ch.state.status, ChatStatus.loadFailed);
      ch.convReply = JsonReply(200, conversationJson('c1', const [('user', 'a')]));
      await ch.ctl.retryLoad();
      expect(ch.state.status, ChatStatus.ready);
    });
  });
}
