import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/features/auth/presentation/login_screen.dart';
import 'package:atlas_mobile/features/profile/presentation/profile_edit_screen.dart';
import 'package:atlas_mobile/features/profile/presentation/selfie_analysis_screen.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../wardrobe/wardrobe_fixtures.dart';
import 'profile_fixtures.dart';

class ProfileApp {
  ProfileApp(this.tester, {FakePicker? picker}) : picker = picker ?? FakePicker(result: photo('selfie.jpg'));
  final WidgetTester tester;
  final FakePicker picker;
  final h = SessionHarness(stored: livePair(1));
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);

  Future<void> start({String at = AtlasRoutes.profile}) async {
    h.backend.handlers.putIfAbsent(
      P.profile,
      () =>
          (r) => r.method == 'GET' ? JsonReply(200, profileJson()) : JsonReply(200, patchResponseJson()),
    );
    if (!h.backend.scripts.containsKey(P.colorProfile)) {
      h.backend.script(P.colorProfile, [JsonReply(200, notAnalysedJson())]);
    }
    if (!h.backend.scripts.containsKey(P.analyze)) {
      h.backend.script(P.analyze, [JsonReply(200, analysisJson())]);
    }
    if (!h.backend.scripts.containsKey(P.account)) {
      h.backend.script(P.account, [
        JsonReply(200, {'ok': true}),
      ]);
    }
    container = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(picker),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
      ],
    );
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

  Future<void> open(Finder f) async {
    await tap(f);
    await tester.pump(const Duration(seconds: 1));
    await settle();
  }

  /// Scrolls the screen's first list until [f] is built, then taps it.
  Future<void> reveal(Finder f) async {
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).last);
    await tap(f);
  }
}

void main() {
  testWidgets('profile: name, email, preferences, colour card, logout and delete entries', (tester) async {
    final app = ProfileApp(tester);
    await app.start();
    expect(find.text('Aziza'), findsOneWidget);
    expect(find.text('a@test.local'), findsOneWidget);
    expect(find.textContaining('To‘q ko‘k'), findsOneWidget);
    expect(find.textContaining('Hali aniqlanmagan'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('profile.delete')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('profile.logout')), findsOneWidget);
  });

  testWidgets('edit: change name + a colour → one PATCH → back to the profile with server truth', (tester) async {
    final app = ProfileApp(tester);
    var patched = false;
    app.h.backend.handlers[P.profile] = (r) {
      if (r.method == 'PATCH') {
        patched = true;
        return JsonReply(200, patchResponseJson());
      }
      return JsonReply(200, patched ? profileJson(name: 'Dilnoza') : profileJson());
    };
    await app.start();
    await app.open(find.byKey(const Key('profile.edit')));
    expect(find.byType(ProfileEditScreen), findsOneWidget);
    await tester.enterText(find.byKey(const Key('profileEdit.name')), 'Dilnoza');
    await app.settle();
    await app.reveal(find.byKey(const Key('profileEdit.likedColor.black')));
    await tester.scrollUntilVisible(
      find.byKey(const Key('profileEdit.bodyNote')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('profileEdit.bodyNote')), findsOneWidget, reason: 'body fields: honest note');
    await app.tap(find.byKey(const Key('profileEdit.save')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(ProfileEditScreen), findsNothing);
    expect(app.h.backend.to(P.profile).where((r) => r.method == 'PATCH'), hasLength(1));
    // The editor pops once the server's profile was read back.
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    await tester.scrollUntilVisible(find.text('Dilnoza'), -200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Dilnoza'), findsOneWidget);
  });

  testWidgets('edit: a failed save keeps the edits and offers Retry', (tester) async {
    final app = ProfileApp(tester);
    app.h.backend.handlers[P.profile] = (r) =>
        r.method == 'PATCH' ? TransportFailure(DioExceptionType.connectionError) : JsonReply(200, profileJson());
    await app.start();
    await app.open(find.byKey(const Key('profile.edit')));
    await tester.enterText(find.byKey(const Key('profileEdit.name')), 'Dilnoza');
    await app.settle();
    await app.tap(find.byKey(const Key('profileEdit.save')));
    expect(find.byKey(const Key('profileEdit.failure')), findsOneWidget);
    expect(find.text('Qayta urinish'), findsOneWidget);
    expect(find.text('Dilnoza'), findsOneWidget);
  });

  testWidgets('colour: not analysed → consent (no picker yet) → camera → progress → result', (tester) async {
    final app = ProfileApp(tester);
    await app.start(at: AtlasRoutes.profileColor);
    expect(find.byKey(const Key('color.notAnalysed')), findsOneWidget);
    await app.open(find.text('Selfi orqali aniqlash'));
    expect(find.byType(SelfieAnalysisScreen), findsOneWidget);
    expect(find.byKey(const Key('selfie.consent')), findsOneWidget);
    expect(find.textContaining('serverda saqlanmaydi'), findsOneWidget);
    expect(find.textContaining('alohida o‘chirib bo‘lmaydi'), findsOneWidget);
    expect(app.picker.calls, isEmpty, reason: 'no permission prompt before consent');
    app.h.backend.gates[P.analyze] = Gate();
    await app.tap(find.byKey(const Key('selfie.camera')));
    expect(find.byKey(const Key('selfie.progress')), findsOneWidget);
    app.h.backend.gates[P.analyze]!.open();
    await app.settle();
    expect(find.byKey(const Key('selfie.done')), findsOneWidget);
    expect(find.textContaining('Ishonch: 82%'), findsOneWidget);
    expect(find.byKey(const Key('color.disclaimer')), findsOneWidget);
    expect(app.picker.front, [true]);
  });

  testWidgets('colour: analysed state with palettes; low-confidence warning on a weak result', (tester) async {
    final app = ProfileApp(tester);
    app.h.backend.script(P.colorProfile, [JsonReply(200, analysedJson())]);
    app.h.backend.script(P.analyze, [JsonReply(200, analysisJson(confidence: 0.1))]);
    await app.start(at: AtlasRoutes.profileColor);
    expect(find.byKey(const Key('color.analysed')), findsOneWidget);
    expect(find.text('Mavsum: Kuz'), findsOneWidget);
    expect(find.text('Zaytun'), findsOneWidget);
    await app.open(find.byKey(const Key('color.reanalyze')));
    await app.tap(find.byKey(const Key('selfie.gallery')));
    expect(find.byKey(const Key('color.lowConfidence')), findsOneWidget);
  });

  testWidgets('colour: a lost answer shows "unknown" with the server\'s current result', (tester) async {
    final app = ProfileApp(tester);
    app.h.backend.script(P.analyze, [TransportFailure(DioExceptionType.receiveTimeout)]);
    await app.start(at: AtlasRoutes.profileColorAnalyze);
    app.h.backend.script(P.colorProfile, [JsonReply(200, analysedJson(season: 'winter'))]);
    await app.tap(find.byKey(const Key('selfie.gallery')));
    expect(find.byKey(const Key('selfie.unknown')), findsOneWidget);
    expect(find.text('Mavsum: Qish'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('selfie.analyseAgain')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('selfie.analyseAgain')), findsOneWidget);
    expect(app.h.backend.calls(P.analyze), 1);
  });

  testWidgets('delete: typed confirmation enables the button → deleted → sign-in says so', (tester) async {
    final app = ProfileApp(tester);
    await app.start(at: AtlasRoutes.profileDelete);
    expect(find.byKey(const Key('delete.explanation')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('delete.confirm'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('delete.typed')), 'ochir');
    await app.settle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('delete.confirm'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('delete.typed')), 'O‘CHIRISH');
    await app.settle();
    await app.tap(find.byKey(const Key('delete.confirm')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('Hisobingiz o‘chirildi.'), findsOneWidget);
    expect(app.h.backend.calls(P.account), 1);
    expect(app.h.backend.calls(P.logout), 0);
  });

  testWidgets('delete: lost answer → unknown + "Tekshirish"; 404 then confirms', (tester) async {
    final app = ProfileApp(tester);
    app.h.backend.script(P.account, [
      TransportFailure(DioExceptionType.receiveTimeout),
      JsonReply(404, errorBody('NOT_FOUND')),
    ]);
    await app.start(at: AtlasRoutes.profileDelete);
    await tester.enterText(find.byKey(const Key('delete.typed')), 'O‘CHIRISH');
    await app.settle();
    await app.tap(find.byKey(const Key('delete.confirm')));
    expect(find.byKey(const Key('delete.unknown')), findsOneWidget);
    expect(app.h.backend.calls(P.account), 1);
    await app.tap(find.byKey(const Key('delete.check')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.text('Hisobingiz o‘chirildi.'), findsOneWidget);
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('layouts hold ($name): profile, edit, colour, consent, result, delete', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final app = ProfileApp(tester);
      app.h.backend.script(P.colorProfile, [JsonReply(200, analysedJson())]);
      await app.start();
      expect(tester.takeException(), isNull);
      for (final route in [
        AtlasRoutes.profileEdit,
        AtlasRoutes.profileColor,
        AtlasRoutes.profileColorAnalyze,
        AtlasRoutes.profileDelete,
      ]) {
        app.router.go(route);
        await tester.pump(const Duration(seconds: 1));
        await app.settle();
        expect(tester.takeException(), isNull, reason: route);
      }
      app.router.go(AtlasRoutes.profileColorAnalyze);
      await tester.pump(const Duration(seconds: 1));
      await app.settle();
      await app.reveal(find.byKey(const Key('selfie.gallery')));
      expect(find.byKey(const Key('selfie.done')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
