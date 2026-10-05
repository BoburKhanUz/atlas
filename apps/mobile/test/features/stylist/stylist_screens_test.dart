import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/features/stylist/presentation/chat_screen.dart';
import 'package:atlas_mobile/features/stylist/presentation/stylist_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'stylist_fixtures.dart';

class StylistApp {
  StylistApp(this.tester);
  final WidgetTester tester;
  final h = SessionHarness(stored: livePair(1));
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);

  Future<void> start({String at = AtlasRoutes.stylist}) async {
    h.backend.handlers.putIfAbsent(
      P.conversations,
      () =>
          (_) => JsonReply(200, conversationsJson(const ['c1', 'c2'])),
    );
    h.backend.handlers['${P.conversations}/c1'] = (_) =>
        JsonReply(200, conversationJson('c1', const [('user', 'Salom'), ('assistant', 'Assalomu alaykum!')]));
    h.backend.script(P.chat, [JsonReply(200, chatJson('c1'))]);
    container = ProviderContainer(overrides: appOverrides(h));
    addTearDown(container.dispose);
    unawaited(h.session.restore());
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
    await settle();
    router.go(at);
    await settle();
  }

  Future<void> settle() async {
    for (var i = 0; i < 25; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 2)));
    }
  }

  Future<void> tap(Finder f) async {
    await tester.ensureVisible(f);
    await tester.pump();
    await tester.tap(f);
    await settle();
  }

  Future<void> openNewChat() async {
    await tap(find.byKey(const Key('stylist.new')));
    await tester.pump(const Duration(seconds: 1));
    await settle();
  }

  Future<void> type(String text) async {
    await tester.enterText(find.byKey(const Key('chat.input')), text);
    await tester.pump();
  }

  String draft() => tester.widget<TextField>(find.byKey(const Key('chat.input'))).controller!.text;
}

void main() {
  testWidgets('list: recent conversations; tap opens the chat with its history', (tester) async {
    final app = StylistApp(tester);
    await app.start();
    expect(find.byKey(const Key('stylist.conversation.c1')), findsOneWidget);
    expect(find.text('Oxirgi xabar c1'), findsOneWidget);
    await app.tap(find.byKey(const Key('stylist.conversation.c1')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.text('Assalomu alaykum!'), findsOneWidget);
  });

  testWidgets('list: empty state with a start action', (tester) async {
    final app = StylistApp(tester);
    app.h.backend.handlers[P.conversations] = (_) => JsonReply(200, conversationsJson(const []));
    await app.start();
    expect(find.byKey(const Key('stylist.empty')), findsOneWidget);
  });

  testWidgets('list: offline state', (tester) async {
    final app = StylistApp(tester);
    app.h.network.online = false;
    app.h.backend.handlers[P.conversations] = (_) => TransportFailure(DioExceptionType.connectionError);
    await app.start();
    expect(find.text('Internet aloqasi yo‘q', skipOffstage: false), findsWidgets);
  });

  testWidgets('chat: send → typing → answer; the draft clears only after confirmation; summary + disclosure', (
    tester,
  ) async {
    final app = StylistApp(tester);
    await app.start();
    await app.openNewChat();
    expect(find.byKey(const Key('chat.disclosure')), findsOneWidget);
    expect(find.textContaining('eslab qolishi mumkin'), findsOneWidget);
    app.h.backend.gates[P.chat] = Gate();
    await app.type('Bugun nima kiyay?');
    await app.tap(find.byKey(const Key('chat.event.work')));
    await app.tap(find.byKey(const Key('chat.send')));
    expect(find.byKey(const Key('chat.typing')), findsOneWidget);
    expect(find.byKey(const Key('chat.pending')), findsOneWidget);
    expect(app.draft(), 'Bugun nima kiyay?', reason: 'kept until the server confirms');
    app.h.backend.gates[P.chat]!.open();
    await app.settle();
    expect(find.text('Ko‘k shim va oq ko‘ylak mos keladi.'), findsOneWidget);
    expect(app.draft(), isEmpty);
    expect(find.byKey(const Key('chat.summary')), findsOneWidget);
    expect((jsonDecode(app.h.backend.to(P.chat).single.bodyText) as Map)['event'], 'work');
  });

  testWidgets('chat: counter; over 2000 characters → Send disabled, nothing sent', (tester) async {
    final app = StylistApp(tester);
    await app.start();
    await app.openNewChat();
    await app.type('a' * 2001);
    expect(find.text('2001 / 2000'), findsOneWidget);
    expect(tester.widget<IconButton>(find.byKey(const Key('chat.send'))).onPressed, isNull);
    await app.type('a' * 2000);
    expect(tester.widget<IconButton>(find.byKey(const Key('chat.send'))).onPressed, isNotNull);
    expect(app.h.backend.calls(P.chat), 0);
  });

  testWidgets('chat: 4xx → error, the draft stays', (tester) async {
    final app = StylistApp(tester);
    await app.start();
    await app.openNewChat();
    app.h.backend.script(P.chat, [JsonReply(400, errorBody('VALIDATION_ERROR'))]);
    await app.type('Salom');
    await app.tap(find.byKey(const Key('chat.send')));
    expect(find.byKey(const Key('chat.failed')), findsOneWidget);
    expect(app.draft(), 'Salom');
  });

  testWidgets('chat: lost answer → unknown banner; refresh shows the server; re-send asks and warns', (tester) async {
    final app = StylistApp(tester);
    await app.start(at: AtlasRoutes.stylistChat('c1'));
    app.h.backend.script(P.chat, [TransportFailure(DioExceptionType.receiveTimeout), JsonReply(200, chatJson('c1'))]);
    await app.type('Kecha nima kiydim?');
    await app.tap(find.byKey(const Key('chat.send')));
    expect(find.byKey(const Key('chat.unknown')), findsOneWidget);
    expect(app.draft(), 'Kecha nima kiydim?');
    app.h.backend.handlers['${P.conversations}/c1'] = (_) => JsonReply(
      200,
      conversationJson('c1', const [
        ('user', 'Salom'),
        ('assistant', 'Assalomu alaykum!'),
        ('user', 'Kecha nima kiydim?'),
        ('assistant', 'Serverdagi javob'),
      ]),
    );
    await app.tap(find.byKey(const Key('chat.refreshFromServer')));
    expect(find.text('Serverdagi javob'), findsOneWidget);
    expect(find.byKey(const Key('chat.unknown')), findsNothing);
    expect(app.draft(), 'Kecha nima kiydim?', reason: 'the user decides');
    await app.tap(find.byKey(const Key('chat.send')));
    expect(find.textContaining('ikki marta'), findsOneWidget);
    await app.tap(find.text('Bekor qilish'));
    expect(app.h.backend.calls(P.chat), 1);
    await app.tap(find.byKey(const Key('chat.send')));
    await app.tap(find.byKey(const Key('chat.confirmResend')));
    expect(app.h.backend.calls(P.chat), 2);
  });

  testWidgets('chat: a lost answer in a NEW chat offers the conversation list', (tester) async {
    final app = StylistApp(tester);
    await app.start();
    await app.openNewChat();
    app.h.backend.script(P.chat, [TransportFailure(DioExceptionType.connectionError)]);
    await app.type('Salom');
    await app.tap(find.byKey(const Key('chat.send')));
    expect(find.byKey(const Key('chat.openList')), findsOneWidget);
    await app.tap(find.byKey(const Key('chat.openList')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(StylistScreen), findsOneWidget);
  });

  testWidgets('Home: "Stilistdan so‘rash" opens a new chat', (tester) async {
    final app = StylistApp(tester);
    await app.start(at: AtlasRoutes.home);
    await tester.scrollUntilVisible(
      find.byKey(const Key('home.stylist')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await app.tap(find.byKey(const Key('home.stylist')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.text('Yangi suhbat'), findsOneWidget);
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('layouts hold ($name): list, chat with a long answer, unknown banner', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final app = StylistApp(tester);
      await app.start();
      expect(tester.takeException(), isNull);
      await app.openNewChat();
      app.h.backend.script(P.chat, [
        JsonReply(200, chatJson('c1', answer: 'Uzun javob. ' * 120)),
        TransportFailure(DioExceptionType.receiveTimeout),
      ]);
      await app.type('Salom');
      await app.tap(find.byKey(const Key('chat.send')));
      expect(tester.takeException(), isNull);
      await app.type('Yana');
      await app.tap(find.byKey(const Key('chat.send')));
      expect(find.byKey(const Key('chat.unknown')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
