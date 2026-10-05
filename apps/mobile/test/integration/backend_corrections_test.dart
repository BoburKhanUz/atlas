// Real-backend integration for Phase 3.6: attribute corrections (PATCH) and
// duplicate-safe recovery of an interrupted upload. Skipped unless
// ATLAS_IT_BASE_URL is set (local, disposable backend only — see
// backend_session_test.dart).
import 'dart:io';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/item_edit.dart';
import 'package:atlas_mobile/features/wardrobe/data/pending_upload_store.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/data/upload_job.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_catalog.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/add_item_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../features/wardrobe/wardrobe_fixtures.dart' show FakePicker, StubCompressor, photo;
import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_session.dart' show MemorySecureStore;
import 'backend_session_test.dart' show Device, registered;
import 'backend_wardrobe_test.dart' show attempt, failureWith, prepared;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];

const _items = '/api/v1/wardrobe/items';

String _other(List<String> options, String? current) => options.firstWhere((o) => o != current);

/// The app's wardrobe providers on a real-backend device (one app run).
ProviderContainer _appRun(Device d, {String name = 'IMG_0042.HEIC'}) {
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
      photoPickerProvider.overrideWithValue(FakePicker(result: photo(name))),
      imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
      uploadSleepProvider.overrideWithValue((_) async {}),
      processStartedAtProvider.overrideWithValue(DateTime.now().toUtc()),
    ],
  );
  c.listen(addItemControllerProvider, (_, _) {});
  return c;
}

void main() {
  group('real backend: corrections', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('PATCH a field → one correction logged, wasCorrected, GET shows it; confidences unchanged', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final item = (await repo.upload(UploadJob.create(prepared()))).item;
      final fit = _other(WardrobeCatalog.fits, item.fit);
      final r = await d.client.call(
        (api) => api.getWardrobeApi().updateWardrobeItem(
          id: item.id,
          wardrobeItemPatchRequest: ItemDraft.toRequest({'fit': fit}),
        ),
      );
      expect(r.corrections, hasLength(1));
      expect(r.corrections.single.field, 'fit');
      expect(r.item.wasCorrected, isTrue);
      final again = await repo.get(item.id);
      expect(again.fit, fit);
      expect(again.correctionLog.map((c) => c.field), ['fit']);
      expect(again.confidences, item.confidences, reason: 'a correction never changes confidences');
    });

    test('the app diff: changed fields only; lists set-compared; same value again → no new log entry', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final item = (await repo.upload(UploadJob.create(prepared()))).item;
      final draft = ItemDraft.of(item)
          .withValue(ItemAttribute.fit, _other(WardrobeCatalog.fits, item.fit))
          .withValue(ItemAttribute.colors, item.colors.reversed.toList());
      final body = draft.patchFrom(item)!;
      expect(body.keys, ['fit'], reason: 'reordered colours are not a change');
      final updated = await repo.update(item.id, body);
      expect(updated.correctionLog, hasLength(1));
      expect(ItemDraft.of(updated).patchFrom(updated), isNull, reason: 'nothing to send now');
      // A PATCH with the current value (bypassing the no-op check): the
      // server answers corrections: [] and logs nothing.
      final same = await d.client.call(
        (api) => api.getWardrobeApi().updateWardrobeItem(
          id: item.id,
          wardrobeItemPatchRequest: ItemDraft.toRequest({'fit': updated.fit}),
        ),
      );
      expect(same.corrections, isEmpty);
      expect((await repo.get(item.id)).correctionLog, hasLength(1));
    });

    test('a value outside the contract is refused before any request', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final item = (await repo.upload(UploadJob.create(prepared()))).item;
      final before = d.apiAdapter.counts['$_items/${item.id}'] ?? 0;
      expect(() => repo.update(item.id, {'fit': 'baggy-ish'}), throwsArgumentError);
      expect(() => repo.update(item.id, {'colors': 'white'}), throwsArgumentError);
      expect(d.apiAdapter.counts['$_items/${item.id}'] ?? 0, before);
    });

    test('PATCH another user\'s item → 404 (indistinguishable from a missing one)', () async {
      final owner = await registered();
      final item = (await WardrobeRepository(owner.client).upload(UploadJob.create(prepared()))).item;
      final stranger = await registered();
      final result = await attempt(() => WardrobeRepository(stranger.client).update(item.id, {'fit': 'slim'}));
      expect(result, failureWith(ApiErrorCode.notFound, 404));
      expect((await WardrobeRepository(owner.client).get(item.id)).correctionLog, isEmpty);
    });

    test('PATCH across an expired access token: refresh, then the PATCH is re-sent once', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final item = (await repo.upload(UploadJob.create(prepared()))).item;
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
      final updated = await WardrobeRepository(e.client)
          .update(item.id, {'fit': _other(WardrobeCatalog.fits, item.fit)});
      expect(updated.correctionLog, hasLength(1), reason: 'applied once');
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['$_items/${item.id}'], 2, reason: '401, then the re-sent PATCH');
    });
  });

  group('real backend: interrupted upload recovery', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('lost answer → restart → same photo reuses the key → replayed, ONE item; record cleared', () async {
      final d = await registered();
      final userId = d.stored!.user.id;
      // Run 1: the server stores the item, the answer is lost.
      d.apiAdapter.loseResponse = (o) => o.method == 'POST' && o.uri.path == _items;
      final run1 = _appRun(d);
      await run1.read(addItemControllerProvider.notifier).pick(PhotoSource.gallery);
      final key = run1.read(addItemControllerProvider).job!.idempotencyKey;
      await run1.read(addItemControllerProvider.notifier).upload();
      expect(run1.read(addItemControllerProvider).phase, AddPhase.failed);
      run1.dispose(); // the app is killed; the prepared bytes are gone
      d.apiAdapter.loseResponse = null;
      final record = await PendingUploadStore(d.kv).read(userId);
      expect(record!.idempotencyKey, key);
      expect((await WardrobeRepository(d.client).list()).items, hasLength(1), reason: 'the server did store it');

      // Run 2 (later): the notice, then the same photo again.
      await Future<void>.delayed(const Duration(milliseconds: 5));
      final run2 = _appRun(d);
      addTearDown(run2.dispose);
      expect(await run2.read(interruptedUploadProvider.future), isNotNull);
      final add = run2.read(addItemControllerProvider.notifier);
      await add.pick(PhotoSource.gallery);
      expect(run2.read(addItemControllerProvider).job!.idempotencyKey, key);
      expect(run2.read(addItemControllerProvider).recovered, isTrue);
      await add.upload();
      final s = run2.read(addItemControllerProvider);
      expect(s.phase, anyOf(AddPhase.completed, AddPhase.needsCorrection));
      expect(s.result!.replayed, isTrue);
      expect((await WardrobeRepository(d.client).list()).items, hasLength(1), reason: 'no duplicate');
      expect(await PendingUploadStore(d.kv).read(userId), isNull);
    });

    test('after an interruption, a DIFFERENT photo gets a new key (never a mismatch)', () async {
      final d = await registered();
      d.apiAdapter.loseResponse = (o) => o.method == 'POST' && o.uri.path == _items;
      final run1 = _appRun(d);
      await run1.read(addItemControllerProvider.notifier).pick(PhotoSource.gallery);
      final key = run1.read(addItemControllerProvider).job!.idempotencyKey;
      await run1.read(addItemControllerProvider.notifier).upload();
      run1.dispose();
      d.apiAdapter.loseResponse = null;

      final run2 = _appRun(d, name: 'OTHER_PHOTO.HEIC');
      addTearDown(run2.dispose);
      final add = run2.read(addItemControllerProvider.notifier);
      await add.pick(PhotoSource.gallery);
      expect(run2.read(addItemControllerProvider).job!.idempotencyKey, isNot(key));
      await add.upload();
      final s = run2.read(addItemControllerProvider);
      expect(s.phase, anyOf(AddPhase.completed, AddPhase.needsCorrection));
      expect(s.result!.replayed, isFalse);
      expect((await WardrobeRepository(d.client).list()).items, hasLength(2));
    });
  });
}
