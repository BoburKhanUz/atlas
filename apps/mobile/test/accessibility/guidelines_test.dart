import 'dart:async';
import 'dart:ui' show SemanticsFlag;

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/widgets/signed_image.dart';
import 'package:atlas_mobile/features/weather/data/city_store.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../features/outfits/outfit_fixtures.dart';
import '../features/stylist/stylist_fixtures.dart';
import '../features/wardrobe/wardrobe_fixtures.dart' show itemJson, pageJson;
import '../support/fake_http.dart';
import '../support/fake_session.dart';
import '../support/jpeg_fixtures.dart';

/// The real app with data on every main screen (items with images, saved
/// outfits, conversations, weather for a stored city).
class A11yApp {
  A11yApp(this.tester, {bool signedIn = true}) : h = SessionHarness(stored: signedIn ? livePair(1) : null);
  final WidgetTester tester;
  final SessionHarness h;
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);

  Future<void> start() async {
    PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages();
    h.kv.values[CityStore.keyFor('u1')] = 'tashkent';
    h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.now().toUtc()))]);
    h.backend.script(P.wardrobe, [
      JsonReply(200, pageJson(['top1', 'bottom1', 'shoes1'])),
    ]);
    h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: weatherUsedJson()))]);
    h.backend.handlers[P.outfits] = (r) => JsonReply(200, listJson([summaryJson('o1', name: 'Juma ofis')]));
    h.backend.handlers['${P.outfits}/o1'] = (r) => JsonReply(200, detailJson('o1', name: 'Juma ofis'));
    h.backend.script(P.conversations, [
      JsonReply(200, conversationsJson(['c1', 'c2'])),
    ]);
    h.backend.handlers['${P.conversations}/c1'] = (r) => JsonReply(
      200,
      conversationJson('c1', [('user', 'Bugun ishga nima kiyay?'), ('assistant', 'Ko‘k shim va oq ko‘ylak.')]),
    );
    for (final id in ['top1', 'top2', 'bottom1', 'shoes1']) {
      h.backend.handlers['${P.wardrobe}/$id'] = (r) => JsonReply(200, {'item': itemJson(id)});
      for (final variant in ['thumb', 'display']) {
        h.backend.handlers['/api/v1/media/users/u1/${id}_$variant.webp'] = (r) =>
            BytesReply(200, fixtureBytes('plain_landscape.jpg'));
      }
    }
    container = ProviderContainer(
      overrides: [...appOverrides(h), weatherClockProvider.overrideWithValue(() => DateTime.now().toUtc())],
    );
    addTearDown(container.dispose);
    unawaited(h.session.restore());
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
    await settle();
  }

  Future<void> settle() async {
    for (var i = 0; i < 25; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 2)));
    }
  }

  Future<void> go(String location) async {
    router.go(location);
    await settle();
  }

  /// Brings an already built (cache-extent) widget on screen.
  Future<void> reveal(String key) async {
    await tester.ensureVisible(find.byKey(Key(key), skipOffstage: false));
    await settle();
  }

  Future<void> tap(Finder f) async {
    await tester.ensureVisible(f);
    await tester.pump();
    await tester.tap(f);
    await settle();
  }
}

/// Every guideline the framework checks reliably on these screens.
Future<void> expectGuidelines(WidgetTester tester, String screen, {bool contrast = true}) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline), reason: '$screen: Android 48 dp tap targets');
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline), reason: '$screen: iOS 44 pt tap targets');
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline), reason: '$screen: tappables are labelled');
  if (contrast) {
    await expectLater(tester, meetsGuideline(textContrastGuideline), reason: '$screen: text contrast');
  }
}

void main() {
  testWidgets('signed-out screens: login and register', (tester) async {
    final semantics = tester.ensureSemantics();
    final app = A11yApp(tester, signedIn: false);
    await app.start();
    expect(app.router.routerDelegate.currentConfiguration.uri.path, AtlasRoutes.login);
    await expectGuidelines(tester, 'login');
    await app.go(AtlasRoutes.register);
    await expectGuidelines(tester, 'register');
    semantics.dispose();
  });

  testWidgets('main tabs: home, wardrobe, outfits, stylist, profile', (tester) async {
    final semantics = tester.ensureSemantics();
    final app = A11yApp(tester);
    await app.start();
    for (final route in [
      AtlasRoutes.home,
      AtlasRoutes.wardrobe,
      AtlasRoutes.outfits,
      AtlasRoutes.stylist,
      AtlasRoutes.profile,
    ]) {
      await app.go(route);
      // Image thumbnails are not text: contrast is checked on text-only
      // screens (the contrast check samples pixels behind every text run).
      await expectGuidelines(tester, route, contrast: route != AtlasRoutes.wardrobe && route != AtlasRoutes.outfits);
    }

    // Outfits: generated candidates (thumbnails + actions) and the saved list.
    await app.go(AtlasRoutes.outfits);
    await app.tap(find.byKey(const Key('outfits.generate')));
    await app.reveal('candidate.t1');
    expect(find.byType(SignedImage), findsWidgets);
    await expectGuidelines(tester, 'outfits: candidates', contrast: false);
    await app.reveal('outfits.tabs');
    await app.tap(find.descendant(of: find.byKey(const Key('outfits.tabs')), matching: find.text('Saqlangan')));
    expect(find.byType(SignedImage), findsWidgets);
    await expectGuidelines(tester, 'outfits: saved', contrast: false);
    semantics.dispose();
  });

  testWidgets('detail and form screens', (tester) async {
    final semantics = tester.ensureSemantics();
    final app = A11yApp(tester);
    await app.start();
    for (final (route, contrast) in [
      (AtlasRoutes.wardrobeItem('top1'), false),
      (AtlasRoutes.outfitDetail('o1'), false),
      (AtlasRoutes.stylistChat('c1'), true),
      (AtlasRoutes.stylistNew, true),
      (AtlasRoutes.profileEdit, true),
      (AtlasRoutes.profileColor, true),
      (AtlasRoutes.profileDelete, true),
    ]) {
      await app.go(route);
      await expectGuidelines(tester, route, contrast: contrast);
    }
    semantics.dispose();
  });

  testWidgets('decorative thumbnails are not in the semantics tree; labelled images are', (tester) async {
    final semantics = tester.ensureSemantics();
    final app = A11yApp(tester);
    await app.start();
    final images = find.semantics.byFlag(SemanticsFlag.isImage);

    await app.go(AtlasRoutes.wardrobe);
    expect(find.byType(SignedImage), findsWidgets);
    expect(images, findsNothing, reason: 'grid thumbnails sit inside the labelled card');
    expect(find.bySemanticsLabel(RegExp('Futbolka')), findsWidgets, reason: 'the card itself stays labelled');

    await app.go(AtlasRoutes.outfits);
    await app.tap(find.byKey(const Key('outfits.generate')));
    await app.reveal('candidate.t1');
    expect(find.byType(SignedImage), findsWidgets);
    expect(images, findsNothing, reason: 'candidate thumbnails: the item name is the text below');
    await app.reveal('outfits.tabs');
    await app.tap(find.descendant(of: find.byKey(const Key('outfits.tabs')), matching: find.text('Saqlangan')));
    expect(find.byType(SignedImage), findsWidgets);
    expect(images, findsNothing);

    await app.go(AtlasRoutes.outfitDetail('o1'));
    expect(find.byType(SignedImage), findsWidgets);
    expect(images, findsNothing);

    // The item detail photo is content, not decoration: it keeps its label.
    await app.go(AtlasRoutes.wardrobeItem('top1'));
    expect(find.bySemanticsLabel('Kiyim surati'), findsOneWidget);
    semantics.dispose();
  });
}
