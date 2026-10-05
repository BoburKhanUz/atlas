import 'dart:convert';

import 'package:atlas_mobile/features/outfits/data/outfits_repository.dart';
import 'package:atlas_mobile/features/outfits/presentation/generate_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/data/device_locator.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'outfit_fixtures.dart';

class Gen {
  Gen() {
    c = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        outfitSeedProvider.overrideWithValue(() => ++seed),
        weatherClockProvider.overrideWithValue(() => DateTime.utc(2026, 10, 5, 10, 5)),
      ],
    );
    addTearDown(c.dispose);
    h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: weatherUsedJson()))]);
    h.backend.script(P.weather, [JsonReply(200, weatherJson())]);
    h.backend.handlers[P.outfits] = (r) =>
        r.method == 'POST' ? postReplies[(posts++).clamp(0, postReplies.length - 1)] : listReply();
    h.backend.handlers['${P.outfits}/o1/feedback'] = (r) => JsonReply(201, feedbackJson('o1', 'liked'));
    h.backend.handlers['${P.outfits}/o1'] = (r) => JsonReply(200, rowJson('o1'));
  }

  final h = SessionHarness(stored: pair(1));
  late final ProviderContainer c;
  var seed = 100;
  var posts = 0;
  var postReplies = <FakeReply>[JsonReply(201, saveResponseJson('o1'))];
  FakeReply Function() listReply = () => JsonReply(200, listJson(const []));

  GenerateController get ctl => c.read(generateControllerProvider.notifier);
  GenerateState get state => c.read(generateControllerProvider);
  CandidateState get t1 => state.candidate('t1');

  List<SentRequest> get saves => h.backend.to(P.outfits).where((r) => r.method == 'POST').toList();
  List<SentRequest> get listReads => h.backend.to(P.outfits).where((r) => r.method == 'GET').toList();
  List<SentRequest> get feedbacks => h.backend.to('${P.outfits}/o1/feedback');
  List<SentRequest> get patches => h.backend.to('${P.outfits}/o1').where((r) => r.method == 'PATCH').toList();
  Map<String, Object?> json(SentRequest r) => jsonDecode(r.bodyText) as Map<String, Object?>;

  /// Paths of the writes after generation, in order.
  List<String> get writes => [
    for (final r in h.backend.sent)
      if (r.method != 'GET' && r.uri.path != P.generate) '${r.method} ${r.uri.path}',
  ];

  Future<void> start({bool generated = true}) async {
    await h.session.restore();
    c.listen(generateControllerProvider, (_, _) {});
    if (generated) await ctl.generate();
  }
}

void main() {
  group('generate', () {
    test(
      'no location known, permission not asked: the user action prompts once; fresh weather is sent as an object',
      () async {
        final g = Gen();
        await g.start();
        expect(g.h.locator.requests, 1);
        final body = g.json(g.h.backend.to(P.generate).single);
        expect(body['weather'], weatherUsedJson(), reason: 'fresh weather → object');
        expect(body.containsKey('lat'), isFalse);
        expect(body['seed'], 101);
        expect(g.state.phase, GeneratePhase.ready);
        expect(g.state.result!.outfits, hasLength(2));
      },
    );

    test('location denied → generated WITHOUT weather; null weatherUsed decodes', () async {
      final g = Gen();
      g.h.locator.onRequest = LocationAccess.denied;
      g.h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: null))]);
      await g.start();
      final body = g.json(g.h.backend.to(P.generate).single);
      expect(body.keys.toSet(), {'seed', 'topN'});
      expect(g.state.result!.weatherUsed, isNull);
      expect(g.h.backend.calls(P.weather), 0);
    });

    test('weather unavailable but location known → the rounded lat/lon (server looks it up)', () async {
      final g = Gen();
      g.h.locator.current = LocationAccess.granted;
      g.h.backend.script(P.weather, [JsonReply(500, errorBody('INTERNAL'))]);
      await g.start();
      final body = g.json(g.h.backend.to(P.generate).single);
      expect((body['lat'], body['lon']), (41.31, 69.28));
      expect(body.containsKey('weather'), isFalse);
    });

    test('a chosen city is used (no device location at all)', () async {
      final g = Gen();
      g.h.kv.values['atlas.weather.city.u1'] = Cities.byId('termez')!.id;
      await g.start();
      expect(g.h.locator.requests + g.h.locator.reads, 0);
      expect(g.h.backend.to(P.weather).single.uri.queryParameters, {'lat': '37.22', 'lon': '67.28'});
    });

    test('empty wardrobe → ready with the server message, no suggestions', () async {
      final g = Gen();
      g.h.backend.script(P.generate, [JsonReply(200, emptyWardrobeJson())]);
      await g.start();
      expect(g.state.phase, GeneratePhase.ready);
      expect(g.state.result!.outfits, isEmpty);
      expect(g.state.result!.message, contains('bo‘sh'));
    });

    test('occasion is sent and kept after a failure; no automatic retry; "Boshqa variant" = new seed', () async {
      final g = Gen();
      await g.start(generated: false);
      g.ctl.chooseOccasion('wedding');
      g.h.backend.script(P.generate, [
        TransportFailure(DioExceptionType.connectionError),
        JsonReply(200, generateJson()),
      ]);
      await g.ctl.generate();
      expect(g.state.phase, GeneratePhase.failed);
      expect(g.state.occasion, 'wedding');
      expect(g.h.backend.calls(P.generate), 1, reason: 'POST never retried automatically');
      await g.ctl.generate();
      await g.ctl.generate();
      final bodies = g.h.backend.to(P.generate).map(g.json).toList();
      expect(bodies.map((b) => b['occasion']), everyElement('wedding'));
      expect(bodies.map((b) => b['seed']).toSet(), hasLength(3));
    });

    test('double tap → one request', () async {
      final g = Gen();
      await g.start(generated: false);
      g.h.backend.gates[P.generate] = Gate();
      final a = g.ctl.generate();
      final b = g.ctl.generate();
      await pumpEventQueue();
      g.h.backend.gates[P.generate]!.open();
      await Future.wait([a, b]);
      expect(g.h.backend.calls(P.generate), 1);
    });

    test('401 → refresh → generate re-sent once with the new token', () async {
      final g = Gen();
      await g.start(generated: false);
      g.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      g.h.backend.script(P.generate, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, generateJson())]);
      await g.ctl.generate();
      expect(g.state.phase, GeneratePhase.ready);
      expect(g.h.bearers(P.generate), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    });
  });

  group('save and feedback ordering', () {
    test('Save → exactly one POST (isSaved: true) with the candidate and the weather used', () async {
      final g = Gen();
      await g.start();
      await g.ctl.save('t1');
      expect(g.t1.save, SaveStatus.saved);
      expect(g.t1.outfitId, 'o1');
      final body = g.json(g.saves.single);
      expect(body['isSaved'], isTrue);
      expect(body['weather'], weatherUsedJson());
      expect((body['items']! as List).length, 3);
    });

    test('double tap on Save → one POST', () async {
      final g = Gen();
      await g.start();
      g.h.backend.gates[P.outfits] = Gate();
      final a = g.ctl.save('t1');
      final b = g.ctl.save('t1');
      await pumpEventQueue();
      g.h.backend.gates[P.outfits]!.open();
      await Future.wait([a, b]);
      expect(g.saves, hasLength(1));
    });

    test('like on an unsaved candidate: POST /outfits (isSaved: false) FIRST, then feedback with that id', () async {
      final g = Gen();
      g.postReplies = [JsonReply(201, saveResponseJson('o1', isSaved: false))];
      await g.start();
      await g.ctl.feedback('t1', OutfitFeedback.liked);
      expect(g.writes, ['POST ${P.outfits}', 'POST ${P.outfits}/o1/feedback']);
      expect(g.json(g.saves.single)['isSaved'], isFalse);
      expect(g.json(g.feedbacks.single), {'feedback': 'liked'});
      expect(g.t1.feedback, OutfitFeedback.liked);
      expect(g.t1.isSaved, isFalse);
    });

    test('second feedback reuses the stored id; Save then PATCHes isSaved (no second POST)', () async {
      final g = Gen();
      g.postReplies = [JsonReply(201, saveResponseJson('o1', isSaved: false))];
      await g.start();
      await g.ctl.feedback('t1', OutfitFeedback.liked);
      await g.ctl.feedback('t1', OutfitFeedback.disliked);
      await g.ctl.save('t1');
      expect(g.saves, hasLength(1));
      expect(g.feedbacks, hasLength(2));
      expect(g.json(g.patches.single), {'isSaved': true});
      expect(g.t1.isSaved, isTrue);
    });

    test('feedback failure: not retried automatically; a later tap is a new request', () async {
      final g = Gen();
      await g.start();
      await g.ctl.save('t1');
      g.h.backend.handlers['${P.outfits}/o1/feedback'] = (_) => TransportFailure(DioExceptionType.connectionError);
      await g.ctl.feedback('t1', OutfitFeedback.liked);
      expect(g.t1.feedbackFailed, isTrue);
      expect(g.feedbacks, hasLength(1));
    });

    test('a definite rejection (4xx) → failed, nothing re-sent, no check', () async {
      final g = Gen();
      g.postReplies = [JsonReply(403, errorBody('FORBIDDEN'))];
      await g.start();
      await g.ctl.save('t1');
      expect(g.t1.save, SaveStatus.failed);
      expect(g.saves, hasLength(1));
      expect(g.listReads, isEmpty);
    });
  });

  group('D4: unknown save outcome', () {
    final serverNow = DateTime.utc(2026, 10, 5, 12, 0, 30);
    JsonReply list(List<Map<String, Object?>> outfits) =>
        JsonReply(200, listJson(outfits), headers: {'Date': httpDate(serverNow)});
    Map<String, Object?> stored(String id, {bool isSaved = true, DateTime? at}) => summaryJson(
      id,
      isSaved: isSaved,
      explanation: 'Bugun salqin, shuning uchun…',
      createdAt: at ?? serverNow.subtract(const Duration(seconds: 1)),
    );

    test(
      'lost answer → ONE read of saved outfits; an exact match in the window confirms it (no second POST)',
      () async {
        final g = Gen();
        g.postReplies = [TransportFailure(DioExceptionType.receiveTimeout)];
        g.listReply = () => list([stored('o9')]);
        await g.start();
        await g.ctl.save('t1');
        expect(g.saves, hasLength(1));
        expect(g.listReads.single.uri.queryParameters, {'saved': 'true'});
        expect(g.t1.save, SaveStatus.saved);
        expect(g.t1.outfitId, 'o9');
      },
    );

    test('no proof → "unknown" (never "failed"), never re-sent; Save is blocked until the user decides', () async {
      final g = Gen();
      g.postReplies = [TransportFailure(DioExceptionType.connectionError)];
      g.listReply = () => list(const []);
      await g.start();
      await g.ctl.save('t1');
      expect(g.t1.save, SaveStatus.unknown);
      await g.ctl.save('t1');
      await g.ctl.feedback('t1', OutfitFeedback.liked);
      expect(g.saves, hasLength(1), reason: 'no automatic or implicit second POST');
      expect(g.feedbacks, isEmpty);
    });

    test('inconclusive (two identical saves in the window) → unknown', () async {
      final g = Gen();
      g.postReplies = [JsonReply(500, errorBody('INTERNAL'))];
      g.listReply = () => list([stored('o8'), stored('o9')]);
      await g.start();
      await g.ctl.save('t1');
      expect(g.t1.save, SaveStatus.unknown);
    });

    test('the list read itself fails → unknown', () async {
      final g = Gen();
      g.postReplies = [TransportFailure(DioExceptionType.connectionError)];
      g.listReply = () => JsonReply(500, errorBody('INTERNAL'));
      await g.start();
      await g.ctl.save('t1');
      expect(g.t1.save, SaveStatus.unknown);
    });

    test('"Qayta tekshirish" reads again and can confirm later', () async {
      final g = Gen();
      g.postReplies = [TransportFailure(DioExceptionType.connectionError)];
      g.listReply = () => list(const []);
      await g.start();
      await g.ctl.save('t1');
      g.listReply = () => list([stored('o9')]);
      await g.ctl.recheck('t1');
      expect(g.t1.save, SaveStatus.saved);
      expect(g.saves, hasLength(1));
    });

    test('"Yana saqlash" is an explicit NEW save (may duplicate; the UI warns)', () async {
      final g = Gen();
      g.postReplies = [TransportFailure(DioExceptionType.connectionError), JsonReply(201, saveResponseJson('o2'))];
      g.listReply = () => list(const []);
      await g.start();
      await g.ctl.save('t1');
      await g.ctl.saveAgain('t1');
      expect(g.saves, hasLength(2));
      expect(g.t1.save, SaveStatus.saved);
      expect(g.t1.outfitId, 'o2');
    });

    test(
      'feedback\'s implicit save lost → recent (unfiltered) list checked; unconfirmed → feedback NOT sent',
      () async {
        final g = Gen();
        g.postReplies = [TransportFailure(DioExceptionType.connectionError)];
        g.listReply = () => list(const []);
        await g.start();
        await g.ctl.feedback('t1', OutfitFeedback.liked);
        expect(g.listReads.single.uri.queryParameters, isEmpty);
        expect(g.feedbacks, isEmpty);
        expect(g.t1.save, SaveStatus.unknown);
      },
    );

    test('feedback\'s implicit save confirmed by the check → feedback sent to that id', () async {
      final g = Gen();
      g.postReplies = [TransportFailure(DioExceptionType.connectionError)];
      g.listReply = () => list([stored('o1', isSaved: false)]);
      await g.start();
      await g.ctl.feedback('t1', OutfitFeedback.liked);
      expect(g.writes, ['POST ${P.outfits}', 'POST ${P.outfits}/o1/feedback']);
    });
  });
}
