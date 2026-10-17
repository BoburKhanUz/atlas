import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/features/auth/presentation/forgot_password_screen.dart';
import 'package:atlas_mobile/features/auth/presentation/login_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

/// The real app on a fake backend, signed out (the sign-in screen).
Future<SessionHarness> pumpSignedOut(WidgetTester tester) async {
  final h = SessionHarness();
  final container = ProviderContainer(overrides: appOverrides(h));
  addTearDown(container.dispose);
  unawaited(h.session.restore());
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
  await settle(tester);
  expect(container.read(routerProvider).routerDelegate.currentConfiguration.uri.path, AtlasRoutes.login);
  return h;
}

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

void main() {
  testWidgets('sign-in → forgot password → the link is requested → back to sign-in', (tester) async {
    final h = await pumpSignedOut(tester);
    h.backend.script(P.forgotPassword, [
      JsonReply(200, {'ok': true}),
    ]);

    await tap(tester, find.byKey(const Key('login.forgot')));
    expect(find.byType(ForgotPasswordScreen), findsOneWidget);

    await tap(tester, find.byKey(const Key('forgot.submit')));
    expect(find.text('Emailni kiriting'), findsOneWidget);
    expect(h.backend.calls(P.forgotPassword), 0);

    await tester.enterText(find.byKey(const Key('forgot.email')), ' ali@test.local ');
    await tap(tester, find.byKey(const Key('forgot.submit')));
    expect(h.backend.calls(P.forgotPassword), 1);
    final sent = h.backend.to(P.forgotPassword).single;
    expect(jsonDecode(sent.bodyText), {'email': 'ali@test.local'});
    expect(sent.header('Authorization'), isNull);
    expect(find.byKey(const Key('forgot.sent')), findsOneWidget);
    expect(find.textContaining('havola yuborildi'), findsOneWidget);

    await tap(tester, find.byKey(const Key('forgot.toLogin')));
    await tester.pump(const Duration(seconds: 1)); // the page transition
    expect(find.byType(ForgotPasswordScreen), findsNothing);
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('mail switched off on the server: a clear message, the form stays', (tester) async {
    final h = await pumpSignedOut(tester);
    h.backend.script(P.forgotPassword, [JsonReply(503, errorBody('PASSWORD_RESET_UNAVAILABLE'))]);
    await tap(tester, find.byKey(const Key('login.forgot')));
    await tester.enterText(find.byKey(const Key('forgot.email')), 'ali@test.local');
    await tap(tester, find.byKey(const Key('forgot.submit')));
    expect(find.text('Parolni tiklash hozircha ishlamayapti. Keyinroq qayta urinib ko‘ring.'), findsOneWidget);
    expect(find.byKey(const Key('forgot.sent')), findsNothing);
    expect(find.byKey(const Key('forgot.submit')), findsOneWidget);
  });
}
