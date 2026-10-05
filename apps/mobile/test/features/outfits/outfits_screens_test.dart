import 'dart:async';
import 'dart:convert';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/widgets/signed_image.dart';
import 'package:atlas_mobile/features/outfits/presentation/outfit_detail_screen.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:atlas_mobile/features/weather/data/device_locator.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import '../wardrobe/wardrobe_fixtures.dart' show itemJson, sigFor;
import 'outfit_fixtures.dart';

class OutfitsApp {
  OutfitsApp(this.tester);
  final WidgetTester tester;
  final h = SessionHarness(stored: livePair(1));
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);

  /// Media requests by path (403 first where [rejectFirst] says so).
  final media = <String, int>{};
  final rejectFirst = <String>{};

  FakeReply Function(SentRequest r) outfitsReply = (r) => r.method == 'POST'
      ? JsonReply(201, saveResponseJson('o1'))
      : JsonReply(200, listJson([summaryJson('o1', name: 'Juma ofis')]));

  Future<void> start({String at = AtlasRoutes.home}) async {
    // Decoded images are cached app-wide by (id, variant); start clean.
    PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages();
    h.backend.script(P.weather, [JsonReply(200, weatherJson(fetchedAt: DateTime.now().toUtc()))]);
    h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: weatherUsedJson()))]);
    h.backend.handlers[P.outfits] = (r) => outfitsReply(r);
    h.backend.handlers['${P.outfits}/o1'] = (r) => switch (r.method) {
      'GET' => JsonReply(200, detailJson('o1', name: 'Juma ofis')),
      'PATCH' => JsonReply(
        200,
        rowJson(
          'o1',
          name: (jsonDecode(r.bodyText) as Map)['name'] as String? ?? 'Juma ofis',
          isSaved: (jsonDecode(r.bodyText) as Map)['isSaved'] as bool? ?? true,
        ),
      ),
      _ => JsonReply(200, {'ok': true}),
    };
    h.backend.handlers['${P.outfits}/o1/feedback'] = (r) => JsonReply(201, feedbackJson('o1', 'liked'));
    for (final id in ['top1', 'top2', 'bottom1', 'shoes1']) {
      h.backend.handlers['${P.wardrobe}/$id'] = (r) => JsonReply(200, {'item': itemJson(id)});
      for (final variant in ['thumb', 'display']) {
        final path = '/api/v1/media/users/u1/${id}_$variant.webp';
        h.backend.handlers[path] = (r) {
          final n = media[path] = (media[path] ?? 0) + 1;
          if (n == 1 && rejectFirst.contains(path)) return JsonReply(403, errorBody('FORBIDDEN'));
          return BytesReply(200, fixtureBytes('plain_landscape.jpg'));
        };
      }
    }
    container = ProviderContainer(
      overrides: [...appOverrides(h), weatherClockProvider.overrideWithValue(() => DateTime.now().toUtc())],
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

  /// Scrolls the tab page (lazy slivers) until [f] is built, then taps it.
  Future<void> reveal(Finder f) async {
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    await tap(f);
  }
}

void main() {
  testWidgets('Home: no prompt on open; "Ob-havoni ko‘rish" asks once and shows the weather', (tester) async {
    final app = OutfitsApp(tester);
    await app.start();
    expect(find.byKey(const Key('weather.card')), findsOneWidget);
    expect(app.h.locator.requests, 0);
    expect(app.h.backend.calls(P.weather), 0);
    await app.tap(find.byKey(const Key('weather.locate')));
    expect(app.h.locator.requests, 1);
    expect(find.byKey(const Key('weather.temp')), findsOneWidget);
    expect(find.text('18°'), findsOneWidget);
  });

  testWidgets('Home: permission denied → explanation + manual city → weather for that city', (tester) async {
    final app = OutfitsApp(tester);
    app.h.locator.onRequest = LocationAccess.denied;
    await app.start();
    await app.tap(find.byKey(const Key('weather.locate')));
    expect(find.textContaining('ruxsat berilmadi'), findsOneWidget);
    await app.tap(find.byKey(const Key('weather.city')));
    await app.tap(find.byKey(const Key('city.samarkand')));
    expect(find.byKey(const Key('weather.temp')), findsOneWidget);
    expect(find.textContaining('Samarqand'), findsOneWidget);
    expect(app.h.backend.to(P.weather).single.uri.queryParameters, {'lat': '39.65', 'lon': '66.96'});
    expect(app.h.kv.values['atlas.weather.city.u1'], 'samarkand');
  });

  testWidgets('Home: permanently denied → detected on open without a prompt; settings button', (tester) async {
    final app = OutfitsApp(tester);
    app.h.locator.current = LocationAccess.deniedForever;
    await app.start();
    expect(find.textContaining('Sozlamalardan'), findsOneWidget);
    expect(app.h.locator.requests, 0);
    await app.tap(find.byKey(const Key('weather.settings')));
    expect(app.h.locator.settingsOpened, 1);
  });

  testWidgets('Outfits: generate → cards with reasons, "Nega?", weather used; like and save', (tester) async {
    final app = OutfitsApp(tester);
    app.h.locator.current = LocationAccess.granted;
    app.outfitsReply = (r) => r.method == 'POST'
        ? JsonReply(201, saveResponseJson('o1', isSaved: (jsonDecode(r.bodyText) as Map)['isSaved'] as bool))
        : JsonReply(200, listJson(const []));
    await app.start(at: AtlasRoutes.outfits);
    await app.reveal(find.byKey(const Key('outfits.occasion.work')));
    await app.reveal(find.byKey(const Key('outfits.generate')));
    expect((jsonDecode(app.h.backend.to(P.generate).single.bodyText) as Map<String, Object?>)['occasion'], 'work');
    expect(find.byKey(const Key('outfits.weatherUsed')), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('candidate.t1')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('candidate.t1')), findsOneWidget);
    expect(find.text('Ob-havoga mos'), findsWidgets);
    await app.reveal(find.byKey(const Key('candidate.t1.why')));
    expect(find.byKey(const Key('candidate.t1.explanation')), findsOneWidget);
    await app.reveal(find.byKey(const Key('candidate.t1.like')));
    expect(app.h.backend.to(P.outfits).where((r) => r.method == 'POST'), hasLength(1));
    expect(app.h.backend.calls('${P.outfits}/o1/feedback'), 1);
    await app.reveal(find.byKey(const Key('candidate.t1.save')));
    expect(app.h.backend.to('${P.outfits}/o1').where((r) => r.method == 'PATCH'), hasLength(1));
    expect(find.byKey(const Key('candidate.t1.open')), findsOneWidget);
  });

  testWidgets('Outfits: unknown save outcome is shown honestly, with check / saved list / save again', (tester) async {
    final app = OutfitsApp(tester);
    app.outfitsReply = (r) => r.method == 'POST'
        ? TransportFailure(DioExceptionType.connectionError)
        : JsonReply(200, listJson(const []), headers: {'Date': httpDate(DateTime.now().toUtc())});
    await app.start(at: AtlasRoutes.outfits);
    await app.reveal(find.byKey(const Key('outfits.generate')));
    await app.reveal(find.byKey(const Key('candidate.t1.save')));
    expect(find.byKey(const Key('candidate.t1.unknown')), findsOneWidget);
    expect(find.byKey(const Key('candidate.t1.save')), findsNothing, reason: 'no plain re-save');
    expect(find.textContaining('noma’lum'), findsOneWidget);
    await app.reveal(find.byKey(const Key('candidate.t1.saveAgain')));
    expect(find.textContaining('ikkinchi nusxani'), findsOneWidget);
    await app.tap(find.text('Bekor qilish'));
    expect(app.h.backend.to(P.outfits).where((r) => r.method == 'POST'), hasLength(1));
    await app.reveal(find.byKey(const Key('candidate.t1.openSaved')));
    expect(find.byKey(const Key('outfits.saved.empty')), findsOneWidget);
  });

  testWidgets('Outfits: empty wardrobe → the server message and an add-item action', (tester) async {
    final app = OutfitsApp(tester);
    await app.start(at: AtlasRoutes.outfits);
    app.h.backend.script(P.generate, [JsonReply(200, emptyWardrobeJson())]);
    await app.reveal(find.byKey(const Key('outfits.generate')));
    expect(find.byKey(const Key('outfits.empty')), findsOneWidget);
    expect(find.textContaining('Garderobingiz bo‘sh'), findsOneWidget);
    expect(find.byKey(const Key('outfits.noWeather')), findsOneWidget);
  });

  testWidgets('Generated item image: 403 → the wardrobe item is reloaded → fresh URL (cached by item, not URL)', (
    tester,
  ) async {
    final app = OutfitsApp(tester);
    app.rejectFirst.add('/api/v1/media/users/u1/top1_thumb.webp');
    await app.start(at: AtlasRoutes.outfits);
    await app.reveal(find.byKey(const Key('outfits.generate')));
    bool refreshed() => app.h.backend
        .to('/api/v1/media/users/u1/top1_thumb.webp')
        .any((r) => r.uri.queryParameters['sig'] == sigFor('top1', 't'));
    for (var i = 0; i < 20 && !refreshed(); i++) {
      await app.settle();
    }
    expect(app.h.backend.calls('${P.wardrobe}/top1'), 1);
    final fetched = app.h.backend.to('/api/v1/media/users/u1/top1_thumb.webp');
    expect(fetched.first.uri.queryParameters['sig'], sigOf('top1'), reason: 'the generated URL first (rejected)');
    expect(fetched.last.uri.queryParameters['sig'], sigFor('top1', 't'), reason: 'the fresh signed URL');
    expect(fetched.map((r) => r.header('Authorization')), everyElement(isNull), reason: 'no Bearer to media');
    // Cache identity is the wardrobe item + variant, never the signed URL.
    final cache = PaintingBinding.instance.imageCache;
    expect(cache.containsKey(const SignedImageKey('item:bottom1', ImageVariant.thumbnail)), isTrue);
    expect(cache.containsKey(const SignedImageKey('img-top1', ImageVariant.thumbnail)), isTrue, reason: 'refreshed');
    expect(app.h.backend.calls('${P.wardrobe}/bottom1'), 0, reason: 'only the rejected one is reloaded');
  });

  testWidgets('Saved list → detail → rename, unsave, delete', (tester) async {
    final app = OutfitsApp(tester);
    await app.start(at: AtlasRoutes.outfits);
    await app.tap(find.text('Saqlangan'));
    expect(find.byKey(const Key('outfit.list.o1')), findsOneWidget);
    await app.tap(find.byKey(const Key('outfit.list.o1')));
    expect(find.byType(OutfitDetailScreen), findsOneWidget);
    await app.tap(find.byKey(const Key('outfitDetail.rename')));
    await tester.enterText(find.byKey(const Key('outfitDetail.nameField')), '  Dushanba  ');
    await app.tap(find.byKey(const Key('outfitDetail.nameSave')));
    expect(find.text('Dushanba'), findsOneWidget);
    await app.tap(find.byKey(const Key('outfitDetail.toggleSave')));
    final patches = app.h.backend
        .to('${P.outfits}/o1')
        .where((r) => r.method == 'PATCH')
        .map((r) => jsonDecode(r.bodyText))
        .toList();
    expect(patches, [
      {'name': 'Dushanba'},
      {'isSaved': false},
    ]);
    await app.tap(find.byKey(const Key('outfitDetail.delete')));
    await app.tap(find.byKey(const Key('outfitDetail.confirmDelete')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(OutfitDetailScreen), findsNothing);
    expect(app.h.backend.to('${P.outfits}/o1').where((r) => r.method == 'DELETE'), hasLength(1));
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('layouts hold ($name): Home weather, outfits, unknown save, detail', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final app = OutfitsApp(tester);
      app.h.locator.current = LocationAccess.granted;
      app.outfitsReply = (r) => r.method == 'POST'
          ? TransportFailure(DioExceptionType.connectionError)
          : JsonReply(200, listJson([summaryJson('o1', name: 'Juma ofis')]));
      await app.start();
      expect(find.byKey(const Key('weather.temp')), findsOneWidget, reason: 'granted earlier: loaded on open');
      expect(tester.takeException(), isNull);
      app.router.go(AtlasRoutes.outfits);
      await app.settle();
      await app.reveal(find.byKey(const Key('outfits.generate')));
      expect(tester.takeException(), isNull);
      await app.reveal(find.byKey(const Key('candidate.t1.save')));
      expect(tester.takeException(), isNull);
      app.container.read(outfitsTabProvider.notifier).show(OutfitsTab.saved);
      await app.settle();
      await app.tap(find.byKey(const Key('outfit.list.o1')));
      expect(tester.takeException(), isNull);
      expect(find.byType(OutfitDetailScreen), findsOneWidget);
    });
  }
}
