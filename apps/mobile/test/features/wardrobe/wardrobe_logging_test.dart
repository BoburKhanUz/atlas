// The wardrobe flow logs no Idempotency-Key, no signed URL / signature, no
// image bytes and no token — on success and on every failure path.
import 'dart:convert';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
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

  for (final (name, replies) in [
    ('success', [JsonReply(201, uploadJson('n1')) as FakeReply]),
    (
      'network failure then retry',
      [TransportFailure(DioExceptionType.connectionError), JsonReply(201, uploadJson('n1'))],
    ),
    (
      'in progress then mismatch',
      [
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '1'}),
        JsonReply(409, errorBody('IDEMPOTENCY_KEY_MISMATCH')),
      ],
    ),
    ('rejected image', [JsonReply(422, errorBody('IMAGE_DIMENSIONS'))]),
  ]) {
    test('upload ($name): nothing sensitive in the log', () async {
      final h = SessionHarness(stored: pair(1));
      var n = 0;
      h.backend.handlers[P.wardrobe] = (r) {
        if (r.method == 'GET') return JsonReply(200, pageJson(['a']));
        return replies[(n++).clamp(0, replies.length - 1)];
      };
      final c = ProviderContainer(
        overrides: [
          ...appOverrides(h),
          photoPickerProvider.overrideWithValue(FakePicker(result: photo())),
          imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
          uploadSleepProvider.overrideWithValue((_) async {}),
        ],
      );
      addTearDown(c.dispose);
      c.listen(wardrobeListProvider, (_, _) {});
      await h.session.restore();
      await pumpEventQueue();
      final ctl = c.read(addItemControllerProvider.notifier);
      c.listen(addItemControllerProvider, (_, _) {});
      await ctl.pick(PhotoSource.gallery);
      final job = c.read(addItemControllerProvider).job!;
      await ctl.upload();
      await ctl.upload(); // retry where possible
      lines.add(c.read(addItemControllerProvider).job.toString());

      final text = lines.join('\n');
      expect(lines, isNotEmpty);
      for (final secret in [
        job.idempotencyKey,
        sigFor('a', 'd'),
        sigFor('a', 't'),
        sigFor('n1', 'd'),
        'sig=',
        'exp=',
        access(1),
        refresh(1),
        base64.encode(job.image.bytes.sublist(0, 24)),
        'Exif',
      ]) {
        expect(text, isNot(contains(secret)), reason: 'log must not contain "$secret"');
      }
    });
  }
}
