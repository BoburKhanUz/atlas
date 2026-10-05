// Phase 3.6 paths log no confidence value, no attribute value, no
// Idempotency-Key, no SHA-256 hash, no signed URL and no token.
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/pending_upload_store.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/data/sha256.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'wardrobe_fixtures.dart';

void main() {
  final lines = <String>[];
  late void Function(String) sink;
  late LogPolicy policy;
  setUp(() {
    lines.clear();
    sink = AppLog.sink;
    policy = AppLog.policy;
    AppLog.sink = lines.add;
    AppLog.policy = LogPolicy.verbose;
  });
  tearDown(() {
    AppLog.sink = sink;
    AppLog.policy = policy;
  });

  test('upload → review → acknowledge → edits (fail, 400, 404, success): nothing sensitive logged', () async {
    final h = SessionHarness(stored: pair(1));
    var posts = 0;
    h.backend.handlers[P.wardrobe] = (r) {
      if (r.method == 'GET') return JsonReply(200, pageJson(['n1']));
      return posts++ == 0
          ? TransportFailure(DioExceptionType.receiveTimeout)
          : JsonReply(201, uploadJson('n1', confidences: lowConfidences), headers: {'Idempotent-Replayed': 'true'});
    };
    final patchReplies = <FakeReply>[
      TransportFailure(DioExceptionType.connectionError),
      JsonReply(
        400,
        errorBody(
          'VALIDATION_ERROR',
          details: [
            {'path': 'fit', 'message': 'Invalid enum value. Expected regular, got oversized'},
          ],
        ),
      ),
      JsonReply(200, {
        'item': {...itemJson('n1', confidences: lowConfidences), 'fit': 'oversized'},
      }),
    ];
    var patches = 0;
    h.backend.handlers['${P.wardrobe}/n1'] = (r) => r.method == 'GET'
        ? JsonReply(200, {'item': itemJson('n1', confidences: lowConfidences)})
        : patchReplies[(patches++).clamp(0, patchReplies.length - 1)];
    final c = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(FakePicker(result: photo())),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
        uploadSleepProvider.overrideWithValue((_) async {}),
      ],
    );
    addTearDown(c.dispose);
    await h.session.restore();
    c.listen(addItemControllerProvider, (_, _) {});
    final add = c.read(addItemControllerProvider.notifier);
    await add.pick(PhotoSource.gallery);
    final job = c.read(addItemControllerProvider).job!;
    final hash = sha256Hex(job.image.bytes);
    await add.upload(); // timeout: record kept
    lines.add((await c.read(pendingUploadStoreProvider).read('u1')).toString());
    await add.upload(); // replayed
    for (final a in c.read(addItemControllerProvider).toReview.toList()) {
      add.acknowledge(a);
    }

    c.listen(editItemControllerProvider('n1'), (_, _) {});
    for (var i = 0; i < 20 && c.read(editItemControllerProvider('n1')).draft == null; i++) {
      await pumpEventQueue();
    }
    final edit = c.read(editItemControllerProvider('n1').notifier);
    edit.set(ItemAttribute.fit, 'oversized');
    await edit.save(); // network
    await edit.save(); // 400
    await edit.save(); // ok
    edit.set(ItemAttribute.material, 'not-a-material');
    await edit.save(); // refused locally

    final text = lines.join('\n');
    expect(patches, 3);
    expect(lines, isNotEmpty);
    for (final secret in [
      job.idempotencyKey,
      hash,
      hash.substring(0, 16),
      access(1),
      sigFor('n1', 'd'),
      // confidence values
      for (final v in lowConfidences.values) '$v',
      // attribute values of the item and of the edit
      'oversized', 'tshirt', 'cotton', 'navy', 'not-a-material',
    ]) {
      expect(text, isNot(contains(secret)), reason: 'leaked: $secret');
    }
  });

  test('recovery store failures log only the error type', () async {
    final kv = MemorySecureStore()
      ..failWrites = true
      ..failReads = true
      ..failDeletes = true;
    final store = PendingUploadStore(kv);
    final r = PendingUpload(
      userId: 'u1',
      idempotencyKey: 'key-zzzz-1234',
      sha256: 'abcdef0123456789',
      filename: 'IMG_0042.jpg',
      createdAt: DateTime.now().toUtc(),
    );
    await store.save(r);
    await store.read('u1');
    await store.clear('u1');
    final text = lines.join('\n');
    expect(lines, isNotEmpty);
    expect(text, isNot(contains('key-zzzz-1234')));
    expect(text, isNot(contains('abcdef0123456789')));
    expect(text, isNot(contains('keystore unavailable')), reason: 'error message not logged');
  });
}
