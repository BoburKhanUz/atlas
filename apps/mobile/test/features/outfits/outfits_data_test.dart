import 'dart:convert';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/outfits/data/generated_outfits.dart';
import 'package:atlas_mobile/features/outfits/data/outfits_repository.dart';
import 'package:atlas_mobile/features/outfits/data/save_check.dart';
import 'package:atlas_mobile/features/weather/data/location.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/serializer.dart' show DeserializationError, FullType;
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'outfit_fixtures.dart';

OutfitGenerateResponseOutfitsInner candidate([String id = 't1']) =>
    standardSerializers.deserializeWith(OutfitGenerateResponseOutfitsInner.serializer, candidateJson(id))!;

OutfitSummary summary(
  String id, {
  DateTime? createdAt,
  List<(String, String)>? items,
  int? score = 82,
  bool isSaved = true,
}) => standardSerializers.deserializeWith(
  OutfitSummary.serializer,
  summaryJson(
    id,
    createdAt: createdAt,
    items: items ?? const [('top1', 'top'), ('bottom1', 'bottom'), ('shoes1', 'shoes')],
    score: score,
    isSaved: isSaved,
    explanation: null,
  ),
)!;

void main() {
  group('D1: weatherUsed may be null (generator workaround)', () {
    test('the generated client alone rejects weatherUsed: null (why the workaround exists)', () {
      expect(
        () => standardSerializers.deserializeWith(OutfitGenerateResponse.serializer, emptyWardrobeJson()),
        throwsA(isA<DeserializationError>()),
      );
    });

    test('null → decoded, weatherUsed null; every other field from the generated serializer', () {
      final r = decodeWithNullWeatherUsed(generateJson(weatherUsed: null, occasion: 'work'))!;
      expect(r.weatherUsed, isNull);
      expect(r.outfits.map((o) => o.tempId), ['t1', 't2']);
      expect(r.outfits.first.items.first.imageUrl.text, contains('top1_thumb'));
      expect(r.occasion, 'work');
      expect(r.wardrobeItemCount, 6);
      final empty = decodeWithNullWeatherUsed(emptyWardrobeJson())!;
      expect(empty.outfits, isEmpty);
      expect(empty.message, contains('bo‘sh'));
    });

    test('the workaround does not apply to non-null or missing weatherUsed', () {
      expect(decodeWithNullWeatherUsed(generateJson(weatherUsed: weatherUsedJson())), isNull);
      expect(decodeWithNullWeatherUsed(generateJson()..remove('weatherUsed')), isNull);
      expect(decodeWithNullWeatherUsed('not a map'), isNull);
    });

    test('unrelated mismatches are NOT hidden', () {
      expect(() => decodeWithNullWeatherUsed(generateJson()..remove('wardrobeItemCount')), throwsA(anything));
      expect(() => decodeWithNullWeatherUsed(generateJson()..['outfits'] = 'nope'), throwsA(anything));
    });

    test('recover: only a 2xx DeserializationError with weatherUsed null', () {
      DioException e(Object? data, {int status = 200, Object? error}) {
        final o = RequestOptions(path: '/api/v1/outfits/generate');
        return DioException(
          requestOptions: o,
          response: Response(requestOptions: o, statusCode: status, data: data),
          error: error ?? DeserializationError('x', FullType.unspecified, StateError('x')),
        );
      }

      expect(recoverNullWeatherUsed(e(emptyWardrobeJson())), isNotNull);
      expect(recoverNullWeatherUsed(e(emptyWardrobeJson(), status: 500)), isNull);
      expect(recoverNullWeatherUsed(e(emptyWardrobeJson(), error: StateError('other'))), isNull);
      expect(recoverNullWeatherUsed(e(generateJson()..remove('wardrobeItemCount'))), isNull);
    });

    test('through the real stack: null and non-null both decode; another mismatch is a contract failure', () async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      final repo = OutfitsRepository(h.client);
      h.backend.script(P.generate, [JsonReply(200, emptyWardrobeJson())]);
      final empty = await repo.generate(seed: 1);
      expect(empty.weatherUsed, isNull);
      expect(empty.outfits, isEmpty);

      h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: weatherUsedJson(temperature: 7)))]);
      final full = await repo.generate(seed: 2);
      expect(full.weatherUsed!.temperature, 7);
      expect(full.outfits, hasLength(2));

      h.backend.script(P.generate, [JsonReply(200, generateJson()..remove('wardrobeItemCount'))]);
      expect(() => repo.generate(seed: 3), throwsA(isA<UnexpectedResponseFailure>()));
      expect(h.bearers(P.generate), everyElement('Bearer ${access(1)}'));
    });
  });

  group('generate request', () {
    Future<Map<String, Object?>> body(Future<void> Function(OutfitsRepository) call) async {
      final h = SessionHarness(stored: pair(1));
      await h.session.restore();
      h.backend.script(P.generate, [JsonReply(200, emptyWardrobeJson())]);
      await call(OutfitsRepository(h.client));
      return jsonDecode(h.backend.to(P.generate).single.bodyText) as Map<String, Object?>;
    }

    test('weather object when known (no coordinates sent)', () async {
      final b = await body(
        (r) => r.generate(
          occasion: 'work',
          weather: (
            temperature: 18,
            feelsLike: 17,
            condition: 'cloudy',
            precipitationProbability: 20,
            humidity: 55,
            windSpeed: 12,
            uvIndex: 3,
          ),
          location: RoundedLocation.round(41.31, 69.28),
          seed: 42,
        ),
      );
      expect(b, {'occasion': 'work', 'weather': weatherUsedJson(), 'seed': 42, 'topN': 3});
    });

    test('else the rounded location; else neither', () async {
      expect(await body((r) => r.generate(location: RoundedLocation.round(41.3123, 69.2777), seed: 1)), {
        'lat': 41.31,
        'lon': 69.28,
        'seed': 1,
        'topN': 3,
      });
      expect(await body((r) => r.generate(seed: 1)), {'seed': 1, 'topN': 3});
    });

    test('an unknown occasion is never sent', () async {
      expect(await body((r) => r.generate(occasion: 'party', seed: 1)), {'seed': 1, 'topN': 3});
    });
  });

  group('Phase 4.4 fields', () {
    test('readable reason labels, layering roles and the fallback flag are decoded', () {
      final r = decodeWithNullWeatherUsed(generateJson(weatherUsed: null, fallback: false))!;
      expect(r.fallback, isFalse);
      final c = r.outfits.first;
      expect(c.reasons, ['weather', 'color_harmony']);
      expect(readableReasons(c), ['Ob-havoga mos', 'Ranglar uyg‘un']);
      expect(c.items.map((i) => i.layeringRole.name), ['top', 'bottom', 'footwear']);
      expect(c.items.map((i) => i.role), ['top', 'bottom', 'shoes']); // legacy role kept
      expect(decodeWithNullWeatherUsed(generateJson(weatherUsed: null))!.fallback, isTrue);
    });

    test('without labels (older server) the reasons themselves are shown', () {
      final json = candidateJson('t9')..['reasonLabels'] = <String>[];
      final c = standardSerializers.deserializeWith(OutfitGenerateResponseOutfitsInner.serializer, json)!;
      expect(readableReasons(c), ['weather', 'color_harmony']);
    });
  });

  group('save request', () {
    test('items with roles, rounded nothing, weather used, explicit isSaved', () {
      final req = saveRequestFor(
        candidate(),
        occasion: 'date',
        weatherUsed: standardSerializers.deserializeWith(
          OutfitGenerateResponseWeatherUsedAnyOf.serializer,
          weatherUsedJson(),
        ),
        isSaved: true,
      );
      expect(standardSerializers.serializeWith(OutfitSaveRequest.serializer, req), {
        'items': [
          {'itemId': 'top1', 'role': 'top'},
          {'itemId': 'bottom1', 'role': 'bottom'},
          {'itemId': 'shoes1', 'role': 'shoes'},
        ],
        'occasion': 'date',
        'weather': weatherUsedJson(),
        'score': 82.4,
        'reasons': ['Ob-havoga mos', 'Ranglar uyg‘un'],
        'isSaved': true,
      });
    });
  });

  group('D4: confirming a save whose answer was lost', () {
    final serverNow = DateTime.utc(2026, 10, 5, 12, 0, 30);
    final sent = saveRequestFor(candidate(), occasion: null, weatherUsed: null, isSaved: true);
    String? check(
      List<OutfitSummary> list, {
      DateTime? now,
      Duration since = const Duration(seconds: 20),
      Set<String> known = const {},
    }) => SaveCheck.confirmedId(
      sent: sent,
      outfits: list,
      serverNow: now ?? serverNow,
      sinceAttempt: since,
      knownIds: known,
    );

    final inWindow = DateTime.utc(2026, 10, 5, 12, 0, 15);

    test('exactly one exact match created inside the window → confirmed', () {
      expect(check([summary('a', createdAt: inWindow)]), 'a');
      expect(
        check([
          summary('a', createdAt: inWindow, items: const [('shoes1', 'shoes'), ('top1', 'top'), ('bottom1', 'bottom')]),
        ]),
        'a',
        reason: 'item order is irrelevant',
      );
    });

    test('created before the attempt (beyond slack) → not proof', () {
      expect(check([summary('a', createdAt: DateTime.utc(2026, 10, 5, 12, 0, 4))]), isNull);
      expect(
        check([summary('a', createdAt: DateTime.utc(2026, 10, 5, 12, 0, 5))]),
        'a',
        reason: 'window edge (5 s slack)',
      );
      expect(check([summary('a', createdAt: DateTime.utc(2026, 10, 5, 12, 0, 36))]), isNull, reason: 'in the future');
    });

    test('two matches → inconclusive', () {
      expect(check([summary('a', createdAt: inWindow), summary('b', createdAt: inWindow)]), isNull);
    });

    test('any field different → no match', () {
      expect(
        check([
          summary('a', createdAt: inWindow, items: const [('top1', 'bottom'), ('bottom1', 'top'), ('shoes1', 'shoes')]),
        ]),
        isNull,
      );
      expect(
        check([
          summary('a', createdAt: inWindow, items: const [('top1', 'top'), ('bottom1', 'bottom')]),
        ]),
        isNull,
      );
      expect(check([summary('a', createdAt: inWindow, score: 83)]), isNull);
      expect(check([summary('a', createdAt: inWindow, isSaved: false)]), isNull);
    });

    test('score is compared as the server stores it (rounded)', () {
      expect(check([summary('a', createdAt: inWindow, score: 82)]), 'a');
    });

    test('no server Date → never confirmed; ids already known are excluded', () {
      expect(
        SaveCheck.confirmedId(
          sent: sent,
          outfits: [summary('a', createdAt: DateTime.now().toUtc())],
          serverNow: null,
          sinceAttempt: const Duration(minutes: 1),
        ),
        isNull,
        reason: 'the device clock is never a substitute for the server Date',
      );
      expect(check([summary('a', createdAt: inWindow)], known: {'a'}), isNull);
    });

    test('HTTP date parsing', () {
      expect(HttpDateParser.parse('Mon, 05 Oct 2026 12:00:30 GMT'), serverNow);
      expect(() => HttpDateParser.parse('yesterday'), throwsFormatException);
      expect(httpDate(serverNow), 'Mon, 05 Oct 2026 12:00:30 GMT');
    });
  });

  test('the list carries the server Date', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    h.backend.script(P.outfits, [
      JsonReply(200, listJson([summaryJson('a')]), headers: {'Date': 'Mon, 05 Oct 2026 12:00:30 GMT'}),
    ]);
    final list = await OutfitsRepository(h.client).list(savedOnly: true);
    expect(list.serverDate, DateTime.utc(2026, 10, 5, 12, 0, 30));
    expect(h.backend.to(P.outfits).single.uri.queryParameters, {'saved': 'true'});
    expect(list.outfits.single.items, isA<BuiltList<OutfitSummaryItem>>());
  });
}
