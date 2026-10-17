import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/core/widgets/state_views.dart';
import 'package:atlas_mobile/features/legal/presentation/legal_document_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

const _ageRequired = '18 yoshdan kattaligingizni tasdiqlang.';
const _consentRequired = 'Ro‘yxatdan o‘tish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering.';
const _outdated = 'Foydalanish shartlari yangilangan. Ularni qayta ko‘rib chiqing va tasdiqlang.';

/// The real app on a fake backend, signed out unless [stored] is given.
class LegalApp {
  LegalApp(this.tester, {SessionTokens? stored}) : h = SessionHarness(stored: stored);
  final WidgetTester tester;
  final SessionHarness h;
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);
  String get location => router.routerDelegate.currentConfiguration.uri.toString();

  Future<void> start(String at) async {
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

  /// Scrolls the screen's list until [f] is built, then taps it.
  Future<void> reveal(Finder f) async {
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).last);
    await tap(f);
  }

  Future<void> fillRegister() async {
    await tester.enterText(find.byKey(const Key('register.email')), 'new@test.local');
    await tester.enterText(find.byKey(const Key('register.password')), 'long-enough-pw');
    await tester.pump();
  }

  Map<String, Object?> registerBody(int i) => jsonDecode(h.backend.to(P.register)[i].bodyText) as Map<String, Object?>;
}

void main() {
  group('registration consent', () {
    testWidgets('both boxes are required; the request carries the loaded version and the 18+ answer', (tester) async {
      final app = LegalApp(tester);
      app.h.backend.script(P.legal, [JsonReply(200, legalJson(version: 'v-test'))]);
      app.h.backend.script(P.register, [JsonReply(201, pairJson(1))]);
      await app.start(AtlasRoutes.register);
      await app.fillRegister();

      await app.tap(find.byKey(const Key('register.submit')));
      expect(find.text(_ageRequired), findsOneWidget);
      expect(find.text(_consentRequired), findsOneWidget);
      expect(app.h.backend.calls(P.register), 0);

      await app.tap(find.byKey(const Key('register.age')));
      await app.tap(find.byKey(const Key('register.submit')));
      expect(find.text(_ageRequired), findsNothing);
      expect(find.text(_consentRequired), findsOneWidget);
      expect(app.h.backend.calls(P.register), 0);

      await app.tap(find.byKey(const Key('register.consent')));
      await app.tap(find.byKey(const Key('register.submit')));
      expect(app.h.backend.calls(P.register), 1);
      expect(
        app.registerBody(0),
        allOf(containsPair('acceptedLegalVersion', 'v-test'), containsPair('ageConfirmed', true)),
      );
      expect(app.h.session.state, isA<Authenticated>());
      expect(app.location, AtlasRoutes.home);
    });

    testWidgets('the documents open from the form; back keeps what was typed and the loaded documents', (tester) async {
      final app = LegalApp(tester);
      await app.start(AtlasRoutes.register);
      await app.fillRegister();

      await app.tap(find.byKey(const Key('register.privacy')));
      expect(find.byType(LegalDocumentScreen), findsOneWidget);
      expect(find.text('Maxfiylik siyosati: asosiy qoida'), findsOneWidget);
      expect(find.text('Maxfiylik siyosati matni.'), findsOneWidget);
      // A list item: the bullet is drawn separately, not part of the text.
      expect(find.text('Maxfiylik siyosati bandi'), findsOneWidget);
      expect(find.byKey(const Key('legal.draft')), findsOneWidget);
      expect(find.text('Kuchga kirish sanasi: 17.10.2026 · Versiya: 2026-10-17-draft'), findsOneWidget);

      await tester.pageBack();
      await app.settle();
      expect(find.byType(LegalDocumentScreen), findsNothing);
      expect(app.location, AtlasRoutes.register);
      expect(find.text('new@test.local'), findsOneWidget);

      await app.tap(find.byKey(const Key('register.terms')));
      expect(find.text('Foydalanish shartlari: asosiy qoida'), findsOneWidget);
      expect(app.h.backend.calls(P.legal), 1, reason: 'loaded once while the register screen is open');
    });

    testWidgets('documents changed since they were loaded: message, consent asked again, new version sent', (
      tester,
    ) async {
      final app = LegalApp(tester);
      app.h.backend.script(P.legal, [
        JsonReply(200, legalJson(version: 'v1')),
        JsonReply(200, legalJson(version: 'v2')),
      ]);
      app.h.backend.script(P.register, [
        JsonReply(
          400,
          errorBody(
            'VALIDATION_ERROR',
            error: _outdated,
            details: [
              {'path': 'acceptedLegalVersion', 'message': _outdated},
            ],
          ),
        ),
        JsonReply(201, pairJson(1)),
      ]);
      await app.start(AtlasRoutes.register);
      await app.fillRegister();
      await app.tap(find.byKey(const Key('register.age')));
      await app.tap(find.byKey(const Key('register.consent')));
      await app.tap(find.byKey(const Key('register.submit')));

      expect(find.text(_outdated), findsOneWidget);
      expect(app.h.session.state, const Unauthenticated());
      expect(app.h.backend.calls(P.legal), 2, reason: 'the new documents are loaded');

      await app.tap(find.byKey(const Key('register.submit')));
      expect(find.text(_consentRequired), findsOneWidget, reason: 'the consent box was cleared');
      expect(app.h.backend.calls(P.register), 1);

      await app.tap(find.byKey(const Key('register.consent')));
      await app.tap(find.byKey(const Key('register.submit')));
      expect(app.registerBody(1), containsPair('acceptedLegalVersion', 'v2'));
      expect(app.h.session.state, isA<Authenticated>());
    });

    testWidgets('documents unavailable: registration says so and sends nothing; it loads them again next time', (
      tester,
    ) async {
      final app = LegalApp(tester);
      app.h.backend.script(P.legal, [
        JsonReply(500, errorBody('INTERNAL_ERROR', error: 'Server xatosi')),
        JsonReply(200, legalJson(version: 'v-ok')),
      ]);
      app.h.backend.script(P.register, [JsonReply(201, pairJson(1))]);
      await app.start(AtlasRoutes.register);
      await app.fillRegister();
      await app.tap(find.byKey(const Key('register.age')));
      await app.tap(find.byKey(const Key('register.consent')));

      // The first load failed; submit loads them again and registers with that version.
      await app.tap(find.byKey(const Key('register.submit')));
      expect(app.h.backend.calls(P.legal), 2);
      expect(app.registerBody(0), containsPair('acceptedLegalVersion', 'v-ok'));
    });
  });

  group('legal documents screen', () {
    testWidgets('signed out: opens directly; a failed load offers a retry', (tester) async {
      final app = LegalApp(tester);
      app.h.backend.script(P.legal, [
        JsonReply(500, errorBody('INTERNAL_ERROR', error: 'Server xatosi')),
        JsonReply(200, legalJson(draft: false)),
      ]);
      await app.start(AtlasRoutes.terms);
      expect(app.location, AtlasRoutes.terms);
      expect(find.byType(ErrorStateView), findsOneWidget);

      await app.tap(find.text('Qayta urinish'));
      expect(find.text('Foydalanish shartlari: asosiy qoida'), findsOneWidget);
      expect(find.byKey(const Key('legal.draft')), findsNothing, reason: 'final texts carry no draft notice');
    });

    testWidgets('signed in: Profile links both documents', (tester) async {
      final app = LegalApp(tester, stored: livePair(1));
      await app.start(AtlasRoutes.profile);
      await app.reveal(find.byKey(const Key('profile.privacy')));
      expect(find.text('Maxfiylik siyosati: asosiy qoida'), findsOneWidget);
      await tester.pageBack();
      await app.settle();
      await app.reveal(find.byKey(const Key('profile.terms')));
      expect(find.text('Foydalanish shartlari: asosiy qoida'), findsOneWidget);
    });
  });
}
