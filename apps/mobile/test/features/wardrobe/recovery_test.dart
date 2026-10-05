import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart' show CorrectionLogEntry;
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/pending_upload_store.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/data/sha256.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/add_item_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import 'wardrobe_fixtures.dart';

final now = DateTime.utc(2026, 10, 5, 12);

PendingUpload record({
  String user = 'u1',
  String key = 'key-aaaaaaaa',
  String sha = 'h',
  String name = 'IMG_0042.jpg',
  DateTime? at,
}) => PendingUpload(userId: user, idempotencyKey: key, sha256: sha, filename: name, createdAt: at ?? now);

/// What the preparation pipeline produces for photo(): the bytes the
/// recovery hash is computed from.
Future<PreparedImage> preparedPhoto([String name = 'IMG_0042.HEIC']) =>
    ImagePreparer(StubCompressor()).prepare(photo(name).bytes, originalName: name);

class Flow {
  Flow({FakePicker? picker, DateTime? processStart}) : picker = picker ?? FakePicker(result: photo()) {
    h = SessionHarness(stored: pair(1));
    c = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(this.picker),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
        uploadSleepProvider.overrideWithValue((_) async {}),
        if (processStart != null) processStartedAtProvider.overrideWithValue(processStart),
      ],
    );
    addTearDown(c.dispose);
  }

  late final SessionHarness h;
  late final ProviderContainer c;
  final FakePicker picker;

  PendingUploadStore get store => c.read(pendingUploadStoreProvider);
  AddItemController get ctl => c.read(addItemControllerProvider.notifier);
  AddItemState get state => c.read(addItemControllerProvider);
  List<SentRequest> get uploads => h.backend.to(P.wardrobe).where((r) => r.method == 'POST').toList();

  void replies(List<FakeReply> list) {
    var n = 0;
    h.backend.handlers[P.wardrobe] = (r) =>
        r.method == 'GET' ? JsonReply(200, pageJson(const [])) : list[(n++).clamp(0, list.length - 1)];
  }

  Future<void> start() async {
    await h.session.restore();
    c.listen(addItemControllerProvider, (_, _) {});
    await pumpEventQueue();
  }
}

void main() {
  group('recovery store', () {
    test('per user: one user never sees another user\'s record', () async {
      final kv = MemorySecureStore();
      final store = PendingUploadStore(kv, clock: () => now);
      await store.save(record(user: 'u1', key: 'key-u1-xxxxx'));
      await store.save(record(user: 'u2', key: 'key-u2-xxxxx'));
      expect((await store.read('u1'))!.idempotencyKey, 'key-u1-xxxxx');
      expect((await store.read('u2'))!.idempotencyKey, 'key-u2-xxxxx');
      await store.clear('u1');
      expect(await store.read('u1'), isNull);
      expect(await store.read('u2'), isNotNull);
    });

    test('24-hour expiry: valid 1 s before, deleted at exactly 24 h', () async {
      final kv = MemorySecureStore();
      var clock = now.add(const Duration(hours: 23, minutes: 59, seconds: 59));
      final store = PendingUploadStore(kv, clock: () => clock);
      await store.save(record());
      expect(await store.read('u1'), isNotNull);
      clock = now.add(const Duration(hours: 24));
      expect(await store.read('u1'), isNull);
      expect(kv.values.keys.where((k) => k.startsWith('atlas.upload')), isEmpty, reason: 'expired record deleted');
    });

    test('a record never contains image bytes — only user, key, hash, file name, time', () async {
      final prepared = await preparedPhoto();
      final kv = MemorySecureStore();
      final store = PendingUploadStore(kv, clock: () => now);
      await store.save(record(sha: sha256Hex(prepared.bytes), name: prepared.filename));
      final raw = kv.values[PendingUploadStore.keyFor('u1')]!;
      expect((jsonDecode(raw) as Map).keys.toSet(), {
        'v',
        'userId',
        'idempotencyKey',
        'sha256',
        'filename',
        'createdAt',
      });
      expect(raw.length, lessThan(400));
      expect(raw, isNot(contains(base64.encode(prepared.bytes.sublist(0, 32)))));
      expect(containsBytes(Uint8List.fromList(utf8.encode(raw)), prepared.bytes.sublist(100, 140)), isFalse);
    });

    test('a record for another user under this key, or unreadable data, is discarded', () async {
      final kv = MemorySecureStore();
      final store = PendingUploadStore(kv, clock: () => now);
      kv.values[PendingUploadStore.keyFor('u1')] = record(user: 'u2').encode();
      expect(await store.read('u1'), isNull);
      kv.values[PendingUploadStore.keyFor('u1')] = 'garbage';
      expect(await store.read('u1'), isNull);
      expect(kv.values, isEmpty);
    });

    test('storage failures never throw (upload continues)', () async {
      final kv = MemorySecureStore()
        ..failWrites = true
        ..failReads = true
        ..failDeletes = true;
      final store = PendingUploadStore(kv, clock: () => now);
      await store.save(record());
      expect(await store.read('u1'), isNull);
      await store.clear('u1');
    });

    test('descriptions never contain the key or the hash', () {
      final r = record(key: 'secret-key-123', sha: 'deadbeefcafe');
      expect(r.toString(), isNot(contains('secret-key-123')));
      expect(r.toString(), isNot(contains('deadbeefcafe')));
    });
  });

  group('upload lifecycle with recovery records', () {
    test('a record (key, hash, file name) is written BEFORE the first request; success deletes it', () async {
      final f = Flow();
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      final job = f.state.job!;
      String? keyAtSend;
      f.h.backend.handlers[P.wardrobe] = (r) async {
        if (r.method == 'GET') return JsonReply(200, pageJson(const []));
        keyAtSend = (await f.store.read('u1'))?.idempotencyKey;
        return JsonReply(201, uploadJson('n1'));
      };
      await f.ctl.upload();
      expect(keyAtSend, job.idempotencyKey);
      expect(f.state.phase, AddPhase.completed);
      expect(await f.store.read('u1'), isNull);
    });

    test('failure keeps the record; rejection deletes it', () async {
      final f = Flow();
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      f.replies([TransportFailure(DioExceptionType.connectionError)]);
      await f.ctl.upload();
      final kept = await f.store.read('u1');
      expect(kept!.idempotencyKey, f.state.job!.idempotencyKey);
      expect(kept.sha256, sha256Hex(f.state.job!.image.bytes));
      expect(kept.filename, 'IMG_0042.jpg');
      f.replies([JsonReply(422, errorBody('INVALID_IMAGE'))]);
      await f.ctl.upload();
      expect(f.state.phase, AddPhase.rejected);
      expect(await f.store.read('u1'), isNull);
    });

    test('after a restart: same photo (hash + file name) → the SAME key; the server replays; record deleted', () async {
      final prepared = await preparedPhoto();
      final f = Flow();
      await f.store.save(
        record(
          key: 'earlier-key-1234',
          sha: sha256Hex(prepared.bytes),
          name: prepared.filename,
          at: DateTime.now().toUtc(),
        ),
      );
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      expect(f.state.job!.idempotencyKey, 'earlier-key-1234');
      expect(f.state.recovered, isTrue);
      f.replies([
        JsonReply(201, uploadJson('n1'), headers: {'Idempotent-Replayed': 'true'}),
      ]);
      await f.ctl.upload();
      expect(f.uploads.single.header('Idempotency-Key'), 'earlier-key-1234');
      expect(f.state.result!.replayed, isTrue);
      expect(await f.store.read('u1'), isNull);
    });

    test('a different photo (hash) or a different file name → a NEW key', () async {
      for (final (sha, name) in [('another-hash', 'IMG_0042.jpg'), (null, 'OTHER.jpg')]) {
        final prepared = await preparedPhoto();
        final f = Flow();
        await f.store.save(
          record(
            key: 'earlier-key-1234',
            sha: sha ?? sha256Hex(prepared.bytes),
            name: name,
            at: DateTime.now().toUtc(),
          ),
        );
        await f.start();
        await f.ctl.pick(PhotoSource.gallery);
        expect(f.state.job!.idempotencyKey, isNot('earlier-key-1234'));
        expect(f.state.recovered, isFalse);
      }
    });

    test('an expired record (> 24 h) is never reused, and is deleted', () async {
      final prepared = await preparedPhoto();
      final f = Flow();
      await f.store.save(
        record(
          key: 'old-key-12345678',
          sha: sha256Hex(prepared.bytes),
          name: prepared.filename,
          at: DateTime.now().toUtc().subtract(const Duration(hours: 25)),
        ),
      );
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      expect(f.state.job!.idempotencyKey, isNot('old-key-12345678'));
      expect(f.h.kv.values.containsKey(PendingUploadStore.keyFor('u1')), isFalse);
    });

    test('another user\'s record is never used', () async {
      final prepared = await preparedPhoto();
      final f = Flow();
      await f.store.save(
        record(
          user: 'u9',
          key: 'record-of-user-u9',
          sha: sha256Hex(prepared.bytes),
          name: prepared.filename,
          at: DateTime.now().toUtc(),
        ),
      );
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      expect(f.state.job!.idempotencyKey, isNot('record-of-user-u9'));
    });

    test('Android process death: the lost camera photo is recovered and prepared on return', () async {
      final f = Flow(picker: FakePicker(lost: photo('camera.jpg')));
      await f.start();
      for (var i = 0; i < 20 && f.state.phase != AddPhase.preview; i++) {
        await pumpEventQueue();
      }
      expect(f.state.phase, AddPhase.preview);
      expect(f.picker.calls, isEmpty, reason: 'no new picker or permission prompt');
      expect(f.state.job!.image.filename, 'camera.jpg');
    });

    test('timeout while analysing → failed → Retry (same key) → replayed result', () async {
      final f = Flow();
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      f.replies([
        TransportFailure(DioExceptionType.receiveTimeout),
        JsonReply(201, uploadJson('n1'), headers: {'Idempotent-Replayed': 'true'}),
      ]);
      await f.ctl.upload();
      expect(f.state.phase, AddPhase.failed, reason: 'analysing never stays forever');
      await f.ctl.upload();
      expect(f.state.phase, AddPhase.completed);
      expect(f.state.result!.replayed, isTrue);
      expect(f.uploads.map((r) => r.header('Idempotency-Key')).toSet(), hasLength(1));
    });

    test(
      'low confidence → needsCorrection; "this is correct" is session-only (no request, no server change)',
      () async {
        final f = Flow();
        await f.start();
        await f.ctl.pick(PhotoSource.gallery);
        f.replies([JsonReply(201, uploadJson('n1', confidences: lowConfidences))]);
        await f.ctl.upload();
        expect(f.state.phase, AddPhase.needsCorrection);
        final before = f.h.backend.sent.length;
        for (final a in f.state.toReview.toList()) {
          f.ctl.acknowledge(a);
        }
        expect(f.state.phase, AddPhase.completed);
        expect(f.h.backend.sent.length, before, reason: 'acknowledging sends nothing');
        expect(f.state.item!.wasCorrected, isFalse);
        expect(attributesToReview(f.state.item!), isNotEmpty, reason: 'server truth unchanged');
      },
    );

    test('an edit saved in the editor settles the review from server data', () async {
      final f = Flow();
      await f.start();
      await f.ctl.pick(PhotoSource.gallery);
      f.replies([
        JsonReply(201, uploadJson('n1', confidences: {'fit': 0.1})),
      ]);
      await f.ctl.upload();
      expect(f.state.phase, AddPhase.needsCorrection);
      final fixed = f.state.item!.rebuild(
        (b) => b
          ..wasCorrected = true
          ..correctionLog.add(
            CorrectionLogEntry(
              (e) => e
                ..field = 'fit'
                ..from = 'regular'
                ..to = 'slim'
                ..at = DateTime.utc(2026, 10, 5),
            ),
          ),
      );
      f.c.read(wardrobeItemUpdatesProvider.notifier).publish(fixed);
      expect(f.state.phase, AddPhase.completed);
    });

    test('interrupted-upload notice: only for a record left by an EARLIER run', () async {
      final started = DateTime.now().toUtc();
      final earlier = Flow(processStart: started);
      await earlier.store.save(record(at: started.subtract(const Duration(minutes: 5))));
      await earlier.start();
      expect(await earlier.c.read(interruptedUploadProvider.future), isNotNull);

      final current = Flow(processStart: started);
      await current.store.save(record(at: started.add(const Duration(seconds: 1))));
      await current.start();
      expect(await current.c.read(interruptedUploadProvider.future), isNull);
    });
  });
}
