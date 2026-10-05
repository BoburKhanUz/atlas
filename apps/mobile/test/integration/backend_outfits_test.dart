// Real-backend integration for Phase 3.7: weather, outfit generation (null
// and non-null weatherUsed), save/list/detail/rename/unsave/delete,
// feedback, user isolation, an expired access token, and the D4 check of a
// save whose answer was lost. Skipped unless ATLAS_IT_BASE_URL is set
// (local, disposable backend with WEATHER_PROVIDER=mock — see
// backend_session_test.dart).
import 'dart:io';

import 'package:atlas_api/atlas_api.dart' show OutfitSaveRequest, OutfitSaveRequestItemsInner;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/outfits/data/outfits_repository.dart';
import 'package:atlas_mobile/features/outfits/presentation/generate_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:atlas_mobile/features/wardrobe/data/upload_job.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart';
import 'package:atlas_mobile/features/weather/data/location.dart';
import 'package:atlas_mobile/features/weather/data/weather_repository.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:built_collection/built_collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_location.dart';
import '../support/fake_session.dart' show MemorySecureStore;
import 'backend_session_test.dart' show Device, registered;
import 'backend_wardrobe_test.dart' show attempt, failureWith, prepared;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
final _skip = _base == null ? 'set ATLAS_IT_BASE_URL to run' : null;
final _tashkent = RoundedLocation.round(41.3111, 69.2797)!;

/// Uploads a top, a bottom and shoes (categories set with the 3.6 PATCH, as
/// mock vision picks its own) so the engine can build outfits.
Future<List<String>> outfitWardrobe(Device d) async {
  final repo = WardrobeRepository(d.client);
  final ids = <String>[];
  for (final (i, (category, sub)) in const [('shirt', 'tshirt'), ('pants', 'jeans'), ('shoes', 'sneakers')].indexed) {
    final item = (await repo.upload(UploadJob.create(prepared(name: 'piece$i.jpg')))).item;
    final updated = item.category == category && item.subcategory == sub
        ? item
        : await repo.update(item.id, {if (item.category != category) 'category': category, 'subcategory': sub});
    ids.add(updated.id);
  }
  return ids;
}

/// The app's outfit/weather providers on a real-backend device.
ProviderContainer appRun(Device d, {FakeLocator? locator}) {
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
      deviceLocatorProvider.overrideWithValue(locator ?? FakeLocator()),
    ],
  );
  c.listen(generateControllerProvider, (_, _) {});
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('real backend: weather', skip: _skip, () {
    test('current weather for a rounded location; the server cache answers the second time', () async {
      final d = await registered();
      final repo = WeatherRepository(d.client);
      final first = await repo.current(_tashkent);
      expect(first.source_, 'mock');
      expect(first.conditionLabel, isNotEmpty);
      final second = await repo.current(_tashkent);
      expect(second.cached, isTrue);
      expect(d.apiAdapter.authorization['/api/v1/weather/current'], everyElement(startsWith('Bearer ')));
    });
  });

  group('real backend: outfits', skip: _skip, () {
    test('empty wardrobe → weatherUsed null decodes (D1), message, no outfits', () async {
      final d = await registered();
      final r = await OutfitsRepository(d.client).generate(location: _tashkent, seed: 1);
      expect(r.weatherUsed, isNull);
      expect(r.outfits, isEmpty);
      expect(r.wardrobeItemCount, 0);
      expect(r.message, isNotEmpty);
    });

    test('generate with lat/lon → the server looks up the weather; with a weather object → that weather', () async {
      final d = await registered();
      await outfitWardrobe(d);
      final repo = OutfitsRepository(d.client);
      final byLocation = await repo.generate(location: _tashkent, occasion: 'casual', seed: 7);
      expect(byLocation.outfits, isNotEmpty);
      expect(byLocation.weatherUsed, isNotNull);
      expect(byLocation.occasion, 'casual');
      final byObject = await repo.generate(
        weather: (
          temperature: 3,
          feelsLike: -1,
          condition: 'snow',
          precipitationProbability: 80,
          humidity: 90,
          windSpeed: 20,
          uvIndex: 1,
        ),
        seed: 8,
      );
      expect(byObject.weatherUsed!.condition, 'snow');
      expect(byObject.weatherUsed!.temperature, 3);
      final noWeather = await repo.generate(seed: 9);
      expect(noWeather.weatherUsed, isNull, reason: 'D1 with a non-empty wardrobe');
      expect(noWeather.outfits, isNotEmpty);
    });

    test('save → list → detail → rename → unsave → delete', () async {
      final d = await registered();
      await outfitWardrobe(d);
      final c = appRun(d);
      final gen = c.read(generateControllerProvider.notifier);
      await gen.generate();
      final candidate = c.read(generateControllerProvider).result!.outfits.first;
      await gen.save(candidate.tempId);
      final saved = c.read(generateControllerProvider).candidate(candidate.tempId);
      expect(saved.save, SaveStatus.saved);
      final repo = OutfitsRepository(d.client);
      final list = await repo.list(savedOnly: true);
      expect(list.outfits.map((o) => o.id), [saved.outfitId]);
      expect(list.serverDate, isNotNull, reason: 'Date header for the D4 check');
      final detail = await repo.get(saved.outfitId!);
      expect(detail.items.map((i) => i.wardrobeItemId).toSet(), candidate.items.map((i) => i.id).toSet());
      expect(detail.score, candidate.score.round());
      expect((await repo.rename(detail.id, 'Juma ofis')).name, 'Juma ofis');
      expect((await repo.setSaved(detail.id, saved: false)).isSaved, isFalse);
      expect((await repo.list(savedOnly: true)).outfits, isEmpty);
      expect((await repo.list(savedOnly: false)).outfits.single.name, 'Juma ofis');
      await repo.delete(detail.id);
      expect(await attempt(() => repo.get(detail.id)), failureWith(ApiErrorCode.notFound, 404));
    });

    test('feedback on an unsaved candidate: stored first (isSaved false), then liked; Save → PATCH', () async {
      final d = await registered();
      await outfitWardrobe(d);
      final c = appRun(d);
      final gen = c.read(generateControllerProvider.notifier);
      await gen.generate();
      final t = c.read(generateControllerProvider).result!.outfits.first.tempId;
      await gen.feedback(t, OutfitFeedback.liked);
      final s = c.read(generateControllerProvider).candidate(t);
      expect(s.feedback, OutfitFeedback.liked);
      final repo = OutfitsRepository(d.client);
      expect((await repo.list(savedOnly: false)).outfits.single.isSaved, isFalse);
      await gen.save(t);
      expect((await repo.list(savedOnly: true)).outfits.single.id, s.outfitId);
      expect((await repo.list(savedOnly: false)).outfits, hasLength(1), reason: 'no second outfit row');
    });

    test(
      'D4: the answer of a save is lost → the app confirms it from the list (Date + exact match), no re-send',
      () async {
        final d = await registered();
        await outfitWardrobe(d);
        final c = appRun(d);
        final gen = c.read(generateControllerProvider.notifier);
        await gen.generate();
        final t = c.read(generateControllerProvider).result!.outfits.first.tempId;
        d.apiAdapter.loseResponse = (o) => o.method == 'POST' && o.uri.path == '/api/v1/outfits';
        await gen.save(t);
        d.apiAdapter.loseResponse = null;
        final s = c.read(generateControllerProvider).candidate(t);
        expect(s.save, SaveStatus.saved);
        final stored = (await OutfitsRepository(d.client).list(savedOnly: true)).outfits;
        expect(stored.map((o) => o.id), [s.outfitId], reason: 'exactly one row, the one confirmed');
      },
    );

    test('isolation: another user\'s outfit is 404; another user\'s items cannot be saved (403)', () async {
      final owner = await registered();
      final itemIds = await outfitWardrobe(owner);
      final ownerRepo = OutfitsRepository(owner.client);
      final id = await ownerRepo.save(
        OutfitSaveRequest(
          (b) => b
            ..items = ListBuilder([
              for (final (i, itemId) in itemIds.indexed)
                OutfitSaveRequestItemsInner(
                  (x) => x
                    ..itemId = itemId
                    ..role = const ['top', 'bottom', 'shoes'][i],
                ),
            ])
            ..isSaved = true,
        ),
      );
      final stranger = await registered();
      final repo = OutfitsRepository(stranger.client);
      expect(await attempt(() => repo.get(id)), failureWith(ApiErrorCode.notFound, 404));
      expect(await attempt(() => repo.rename(id, 'x')), failureWith(ApiErrorCode.notFound, 404));
      expect(
        await attempt(() async {
          await repo.feedback(id, OutfitFeedback.liked);
          return true;
        }),
        failureWith(ApiErrorCode.notFound, 404),
      );
      expect(
        await attempt(() async {
          await repo.delete(id);
          return true;
        }),
        failureWith(ApiErrorCode.notFound, 404),
      );
      expect((await repo.list(savedOnly: false)).outfits, isEmpty);
      expect(
        await attempt(
          () => repo.save(
            OutfitSaveRequest(
              (b) => b
                ..items = ListBuilder([
                  OutfitSaveRequestItemsInner(
                    (x) => x
                      ..itemId = itemIds.first
                      ..role = 'top',
                  ),
                ]),
            ),
          ),
        ),
        failureWith(ApiErrorCode.forbidden, 403),
      );
      expect((await ownerRepo.get(id)).name, isNull, reason: 'untouched');
    });

    test('generate across an expired access token: refresh, then the POST is re-sent once', () async {
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
      final r = await OutfitsRepository(e.client).generate(seed: 1);
      expect(r.wardrobeItemCount, 0);
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['/api/v1/outfits/generate'], 2, reason: '401, then the re-sent request');
    });
  });
}
