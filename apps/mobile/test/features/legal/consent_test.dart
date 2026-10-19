import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/legal/consent_gate.dart';
import 'package:atlas_mobile/features/legal/presentation/consent_screen.dart';
import 'package:atlas_mobile/features/legal/presentation/legal_document_screen.dart';
import 'package:atlas_mobile/features/legal/providers.dart';
import 'package:atlas_mobile/features/profile/presentation/delete_account_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../onboarding/onboarding_flow_test.dart' show profileJson, profilePath;

/// The real app on a fake backend, signed in as u1; the consent check asks
/// the backend (GET /api/v1/auth/me) like the app does.
Future<(SessionHarness, ProviderContainer)> pumpSignedIn(
  WidgetTester tester, {
  required bool consentRequired,
  bool onboarded = true,
}) async {
  final h = SessionHarness(stored: pair(1));
  h.backend.script(P.me, [JsonReply(200, meJson(consentRequired: consentRequired))]);
  final container = ProviderContainer(overrides: appOverrides(h, onboarded: onboarded, consentRequired: null));
  addTearDown(container.dispose);
  unawaited(h.session.restore());
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await settle(tester);
  return (h, container);
}

String path(ProviderContainer c) => c.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 20));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 2)));
  }
}

Future<void> tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await settle(tester);
}

/// Back from a pushed screen (the page transition outlasts [settle]).
Future<void> back(WidgetTester tester) async {
  await tester.pageBack();
  await tester.pump(const Duration(seconds: 1));
  await settle(tester);
}

Future<void> tickBoth(WidgetTester tester) async {
  await tap(tester, find.byKey(const Key('consent.age')));
  await tap(tester, find.byKey(const Key('consent.accepted')));
}

void main() {
  testWidgets('changed texts: the app opens on the consent screen; accepting sends the version and opens Home', (
    tester,
  ) async {
    final (h, c) = await pumpSignedIn(tester, consentRequired: true);
    expect(path(c), AtlasRoutes.consent);
    expect(find.byType(ConsentScreen), findsOneWidget);
    expect(find.text('Hujjatlar yangilandi'), findsOneWidget);

    await tap(tester, find.byKey(const Key('consent.accept')));
    expect(find.text('18 yoshdan kattaligingizni tasdiqlang.'), findsOneWidget);
    expect(
      find.text('Davom etish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering.'),
      findsOneWidget,
    );
    expect(h.backend.calls(P.legalConsent), 0);

    h.backend.script(P.legalConsent, [
      JsonReply(200, {'ok': true}),
    ]);
    await tickBoth(tester);
    await tap(tester, find.byKey(const Key('consent.accept')));
    final sent = h.backend.to(P.legalConsent).single;
    expect(jsonDecode(sent.bodyText), {'acceptedLegalVersion': '2026-10-17-draft', 'ageConfirmed': true});
    expect(sent.header('Authorization'), isNotNull);
    expect(path(c), AtlasRoutes.home);
    expect(c.read(consentGateProvider).status, ConsentStatus.notRequired);
  });

  testWidgets('an account that never finished onboarding gets it after accepting the changed texts', (tester) async {
    final (h, c) = await pumpSignedIn(tester, consentRequired: true, onboarded: false);
    expect(path(c), AtlasRoutes.consent);
    expect(h.backend.calls(profilePath), 0);

    h.backend.script(profilePath, [JsonReply(200, profileJson())]);
    h.backend.script(P.legalConsent, [
      JsonReply(200, {'ok': true}),
    ]);
    await tickBoth(tester);
    await tap(tester, find.byKey(const Key('consent.accept')));
    expect(path(c), AtlasRoutes.onboarding);
  });

  testWidgets('the texts changed again meanwhile: the new ones are loaded and the consent asked again', (tester) async {
    final (h, c) = await pumpSignedIn(tester, consentRequired: true);
    h.backend.script(P.legalConsent, [
      JsonReply(
        400,
        errorBody(
          'VALIDATION_ERROR',
          details: [
            {
              'path': 'acceptedLegalVersion',
              'message': 'Foydalanish shartlari yangilangan. Ularni qayta ko‘rib chiqing va tasdiqlang.',
            },
          ],
        ),
      ),
    ]);
    final legalLoads = h.backend.calls(P.legal);
    await tickBoth(tester);
    await tap(tester, find.byKey(const Key('consent.accept')));
    expect(find.textContaining('Foydalanish shartlari yangilangan'), findsOneWidget);
    expect(path(c), AtlasRoutes.consent);
    expect(h.backend.calls(P.legal), greaterThan(legalLoads));
    await tap(tester, find.byKey(const Key('consent.accept')));
    expect(h.backend.calls(P.legalConsent), 1, reason: 'the consent box was cleared');
  });

  testWidgets('the documents open from the consent screen; back returns to it', (tester) async {
    await pumpSignedIn(tester, consentRequired: true);
    await tap(tester, find.byKey(const Key('consent.privacy')));
    expect(find.byType(LegalDocumentScreen), findsOneWidget);
    await back(tester);
    expect(find.byType(LegalDocumentScreen), findsNothing);
    expect(find.byType(ConsentScreen), findsOneWidget);
  });

  testWidgets('declining: the account deletion screen opens; signing out leads to sign-in', (tester) async {
    final (h, c) = await pumpSignedIn(tester, consentRequired: true);
    await tap(tester, find.byKey(const Key('consent.delete')));
    expect(find.byType(DeleteAccountScreen), findsOneWidget);
    await back(tester);

    h.backend.script(P.logout, [
      JsonReply(200, {'ok': true}),
    ]);
    await tap(tester, find.byKey(const Key('consent.signOut')));
    expect(h.session.state, isA<Unauthenticated>());
    expect(path(c), AtlasRoutes.login);
  });

  testWidgets('a CONSENT_REQUIRED answer while using the app opens the consent screen', (tester) async {
    final (h, c) = await pumpSignedIn(tester, consentRequired: false);
    expect(path(c), AtlasRoutes.home);
    // Home already loaded the wardrobe; the stylist tab asks the server next.
    h.backend.script(P.conversations, [JsonReply(403, errorBody('CONSENT_REQUIRED'))]);
    await tap(tester, find.descendant(of: find.byType(NavigationBar), matching: find.text('Stilist')));
    expect(path(c), AtlasRoutes.consent);
  });
}
