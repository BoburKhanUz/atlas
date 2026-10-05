// Profile, colour analysis and account deletion never log profile values,
// colour results, selfie bytes or paths, signed URLs or tokens.
import 'dart:convert';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/profile/presentation/delete_account_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/profile_edit_controller.dart';
import 'package:atlas_mobile/features/profile/providers.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../wardrobe/wardrobe_fixtures.dart';
import 'profile_fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
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

  test('profile edit + selfie (ok, lost, 422) + deletion (unknown, confirmed): nothing sensitive logged', () async {
    final h = SessionHarness(stored: pair(1));
    final picked = photo('/private/var/mobile/DCIM/IMG_7777-selfie.jpg');
    var patch = 0;
    h.backend.handlers[P.profile] = (r) => r.method == 'GET'
        ? JsonReply(200, profileJson(name: 'Maxfiy-Ism-Q'))
        : (patch++ == 0 ? JsonReply(400, errorBody('VALIDATION_ERROR')) : JsonReply(200, patchResponseJson()));
    h.backend.script(P.analyze, [
      JsonReply(200, analysisJson(confidence: 0.6789)),
      TransportFailure(DioExceptionType.receiveTimeout),
      JsonReply(422, errorBody('INVALID_IMAGE')),
    ]);
    h.backend.script(P.colorProfile, [JsonReply(200, analysedJson(season: 'winter'))]);
    h.backend.script(P.account, [
      TransportFailure(DioExceptionType.connectionError),
      JsonReply(200, {'ok': true}),
    ]);
    final c = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(FakePicker(result: picked)),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
      ],
    );
    addTearDown(c.dispose);
    await h.session.restore();

    c.listen(profileEditControllerProvider, (_, _) {});
    for (var i = 0; i < 20 && c.read(profileEditControllerProvider).status == ProfileEditStatus.loading; i++) {
      await pumpEventQueue();
    }
    final edit = c.read(profileEditControllerProvider.notifier);
    edit.edit((d) => d.withName('Yangi-Ism-W').toggleFavoriteColor(ColorOption.burgundy));
    await edit.save();
    await edit.save();

    c.listen(selfieAnalysisControllerProvider, (_, _) {});
    final selfie = c.read(selfieAnalysisControllerProvider.notifier);
    await selfie.pick(PhotoSource.gallery);
    selfie.restart();
    await selfie.pick(PhotoSource.gallery);
    selfie.restart();
    await selfie.pick(PhotoSource.gallery);

    c.listen(deleteAccountControllerProvider, (_, _) {});
    final del = c.read(deleteAccountControllerProvider.notifier);
    await del.delete(typed: deleteConfirmationWord);
    await del.delete();

    final text = lines.join('\n');
    expect(lines, isNotEmpty);
    final selfieB64 = base64.encode(picked.bytes.sublist(200, 260));
    for (final secret in [
      'Maxfiy-Ism-Q',
      'Yangi-Ism-W',
      'a@test.local',
      'burgundy',
      'navy',
      'autumn',
      'winter',
      'spring',
      'mustard',
      'olive',
      '0.6789',
      '67.89',
      'IMG_7777',
      '/private/var',
      'DCIM',
      selfieB64,
      access(1),
      refresh(1),
    ]) {
      expect(text, isNot(contains(secret)), reason: 'leaked: $secret');
    }
  });
}
