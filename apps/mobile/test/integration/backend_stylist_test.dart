// Real-backend integration for Phase 3.8 (AI stylist): new and continued
// conversations, transcript order, list order, isolation, an unknown
// conversation id, an expired access token, an over-long message, the
// server's AI fallback answer, and a lost answer resolved by reading the
// server. Skipped unless ATLAS_IT_BASE_URL is set (local, disposable
// backend — see backend_session_test.dart). The local backend has no AI
// key, so every answer is the server's stored fallback text.
import 'dart:io';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/stylist/data/stylist_repository.dart';
import 'package:atlas_mobile/features/stylist/presentation/chat_controller.dart';
import 'package:atlas_mobile/features/stylist/providers.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_location.dart';
import '../support/fake_session.dart' show MemorySecureStore;
import 'backend_session_test.dart' show Device, registered;
import 'backend_wardrobe_test.dart' show attempt, failureWith;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
const _chatPath = '/api/v1/stylist/chat';

ProviderContainer appRun(Device d) {
  final c = ProviderContainer(
    overrides: [
      environmentConfigProvider.overrideWithValue(
        AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: _base!),
      ),
      deviceNetworkProvider.overrideWithValue(FakeNetwork()),
      sessionControllerProvider.overrideWithValue(d.session),
      secureKeyValueStoreProvider.overrideWithValue(d.kv),
      dioProvider.overrideWithValue(d.client.dio),
      atlasApiClientProvider.overrideWithValue(d.client),
      deviceLocatorProvider.overrideWithValue(FakeLocator()),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('real backend: stylist', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('new conversation → the server fallback answer (no AI key) is stored as the assistant turn', () async {
      final d = await registered();
      final r = await StylistRepository(d.client).send(message: 'Bugun nima kiyay?');
      expect(r.conversationId, isNotEmpty);
      expect(r.assistantMessage, contains('AI stilist javob bera olmaydi'), reason: 'backend AI fallback');
      expect(r.contextSummary.wardrobeItemCount, 0);
      final c = await StylistRepository(d.client).conversation(r.conversationId);
      expect(c.messages.map((m) => (m.role, m.content)), [
        ('user', 'Bugun nima kiyay?'),
        ('assistant', r.assistantMessage),
      ]);
      expect(c.title, 'Bugun nima kiyay?');
    });

    test('continuing: the same id; transcript roles and order are user, assistant, user, assistant', () async {
      final d = await registered();
      final repo = StylistRepository(d.client);
      final first = await repo.send(message: 'Birinchi', event: 'work');
      final second = await repo.send(message: 'Ikkinchi', conversationId: first.conversationId);
      expect(second.conversationId, first.conversationId);
      expect(first.contextSummary.eventProvided, isTrue);
      final c = await repo.conversation(first.conversationId);
      expect(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
      expect(c.messages.where((m) => m.fromUser).map((m) => m.content), ['Birinchi', 'Ikkinchi']);
      final times = c.messages.map((m) => m.createdAt!).toList();
      expect([...times]..sort(), times, reason: 'chronological');
    });

    test('the list is ordered by last activity (newest first)', () async {
      final d = await registered();
      final repo = StylistRepository(d.client);
      final a = (await repo.send(message: 'A suhbat')).conversationId;
      final b = (await repo.send(message: 'B suhbat')).conversationId;
      expect((await repo.conversations()).map((c) => c.id), [b, a]);
      await repo.send(message: 'A davomi', conversationId: a);
      final list = await repo.conversations();
      expect(list.map((c) => c.id), [a, b]);
      expect(list.first.lastMessage, isNotNull);
    });

    test('isolation: another user\'s conversation is 404 and never extended', () async {
      final owner = await registered();
      final ownerRepo = StylistRepository(owner.client);
      final id = (await ownerRepo.send(message: 'Maxfiy savol')).conversationId;
      final stranger = await registered();
      final repo = StylistRepository(stranger.client);
      expect(await attempt(() => repo.conversation(id)), failureWith(ApiErrorCode.notFound, 404));
      final r = await repo.send(message: 'Begona', conversationId: id);
      expect(r.conversationId, isNot(id), reason: 'a foreign id starts a NEW conversation for the sender');
      expect((await ownerRepo.conversation(id)).messages, hasLength(2), reason: 'owner untouched');
      expect((await repo.conversations()).map((c) => c.id), [r.conversationId]);
    });

    test('an unknown conversation id → the server starts a new one; the app switches to it', () async {
      final d = await registered();
      final c = appRun(d);
      c.listen(chatControllerProvider(newChatKey), (_, _) {});
      final chat = c.read(chatControllerProvider(newChatKey).notifier);
      await chat.send('Salom');
      final realId = c.read(chatControllerProvider(newChatKey)).conversationId!;
      final r = await StylistRepository(d.client).send(message: 'Salom', conversationId: 'does-not-exist-123');
      expect(r.conversationId, isNot('does-not-exist-123'));
      expect(r.conversationId, isNot(realId));
    });

    test('over-long message: the app refuses it before sending; the server rejects it too (400)', () async {
      final d = await registered();
      expect(StylistLimits.validMessage('a' * 2001), isNull);
      final c = appRun(d);
      c.listen(chatControllerProvider(newChatKey), (_, _) {});
      expect(await c.read(chatControllerProvider(newChatKey).notifier).send('a' * 2001), SendResult.invalid);
      expect(d.apiAdapter.counts[_chatPath], isNull);
      final raw = await attempt(() => StylistRepository(d.client).send(message: 'a' * 2001));
      expect(raw, failureWith(ApiErrorCode.validationError, 400));
      expect((await StylistRepository(d.client).conversations()), isEmpty, reason: 'nothing stored');
    });

    test('lost answer → unknown; refresh shows the server transcript; nothing re-sent', () async {
      final d = await registered();
      final c = appRun(d);
      c.listen(chatControllerProvider(newChatKey), (_, _) {});
      final chat = c.read(chatControllerProvider(newChatKey).notifier);
      await chat.send('Birinchi');
      d.apiAdapter.loseResponse = (o) => o.method == 'POST' && o.uri.path == _chatPath;
      expect(await chat.send('Ikkinchi'), SendResult.unknown);
      d.apiAdapter.loseResponse = null;
      await chat.refresh();
      final s = c.read(chatControllerProvider(newChatKey));
      expect(s.messages.map((m) => m.role), [
        'user',
        'assistant',
        'user',
        'assistant',
      ], reason: 'the server did store it');
      expect(s.messages[2].content, 'Ikkinchi');
      expect(s.resendNeedsConfirmation, isTrue);
      expect(d.apiAdapter.counts[_chatPath], 2, reason: 'no automatic re-send');
    });

    test('expired access token: refresh, then the message is re-sent once', () async {
      final d = await registered();
      final s = d.stored!;
      final e = Device(
        kv: MemorySecureStore()
          ..put(
            SessionTokens(
              user: s.user,
              accessToken: s.accessToken,
              accessTokenExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
              refreshToken: s.refreshToken,
              refreshTokenExpiresAt: s.refreshTokenExpiresAt,
              sessionExpiresAt: s.sessionExpiresAt,
            ),
          ),
      );
      await e.session.restore();
      await Future<void>.delayed(const Duration(seconds: 11));
      final r = await StylistRepository(e.client).send(message: 'Salom');
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts[_chatPath], 2, reason: '401, then the re-sent message');
      expect(
        (await StylistRepository(e.client).conversation(r.conversationId)).messages,
        hasLength(2),
        reason: 'stored once',
      );
    });
  });
}
