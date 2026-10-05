// Real-backend integration for Phase 3.9: profile read/edit (contract
// fields only), the colour profile (not analysed, a real JPEG analysis,
// invalid image, isolation), expired tokens, and account deletion with its
// server-side effects. Skipped unless ATLAS_IT_BASE_URL is set (local,
// disposable backend — see backend_session_test.dart).
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart' show ProfilePatchRequest, ProfileRow, standardSerializers;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/profile/data/color_profile_repository.dart';
import 'package:atlas_mobile/features/profile/data/profile_repository.dart';
import 'package:atlas_mobile/features/profile/presentation/delete_account_controller.dart';
import 'package:atlas_mobile/features/profile/providers.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/upload_job.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_session.dart' show MemorySecureStore;
import 'backend_session_test.dart' show Device, rawPost, registered;
import 'backend_wardrobe_test.dart' show attempt, failureWith, prepared;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
const _password = 'it-profile-pw-123';

String _email() => 'mobile-it-p-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 20)}@test.local';

/// The landscape fixture prepared like a selfie (JPEG, metadata stripped).
PreparedImage selfie() => prepared(name: 'selfie.jpg');

ProviderContainer appRun(Device d) {
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
    ],
  );
  addTearDown(c.dispose);
  return c;
}

/// A device with an access token the server will reject (it believes it
/// is valid for an hour): the next call refreshes and re-sends.
Future<Device> expiredAccess(Device d) async {
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
  return e;
}

void main() {
  // Account deletion clears the in-memory image cache (the app always has
  // a binding). The test binding fakes HTTP; restore real networking for
  // the backend.
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;

  group('real backend: profile', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('GET → PATCH name + preferences → GET shows the server truth', () async {
      final d = await registered();
      final repo = AccountProfileRepository(d.client);
      final before = await repo.get();
      expect(before.name, 'IT');
      expect(before.favoriteColors, isEmpty);
      final draft = before
          .toDraft()
          .withName('  Aziza  ')
          .toggleFavoriteColor(ColorOption.navy)
          .toggleDislikedStyle(StyleOption.sporty);
      await repo.update(draft.patchFrom(before)!);
      final after = await repo.get();
      expect(after.name, 'Aziza');
      expect(after.favoriteColors, {ColorOption.navy});
      expect(after.dislikedStyles, {StyleOption.sporty});
      final cleared = after.toDraft().toggleFavoriteColor(ColorOption.navy);
      await repo.update(cleared.patchFrom(after)!);
      expect((await repo.get()).favoriteColors, isEmpty, reason: 'an emptied list is accepted');
    });

    test('the server stores body fields but the generated contract does not expose them (ProfileRow)', () async {
      final d = await registered();
      // Written here only to prove the gap (the app never sends these).
      await d.client.call(
        (api) => api.getProfileApi().updateProfile(
          profilePatchRequest: standardSerializers.deserializeWith(ProfilePatchRequest.serializer, {
            'profile': {'gender': 'female', 'height': 168},
          })!,
        ),
      );
      final generated = await d.client.call((api) => api.getProfileApi().getProfile());
      final row = standardSerializers.serializeWith(ProfileRow.serializer, generated.profile!)! as Map;
      expect(row.keys.toSet(), {'id', 'userId'}, reason: 'the generated ProfileRow keeps only these');
      final raw = await d.client.dio.get<Map<String, dynamic>>(
        '/api/v1/profile',
        options: Options(
          extra: {
            'secure': [
              {'type': 'http', 'scheme': 'bearer', 'name': 'bearerAuth'},
            ],
          },
        ),
      );
      expect((raw.data!['profile'] as Map)['gender'], 'female', reason: 'the server does send it');
    });

    test('PATCH across an expired access token: refresh, then re-sent once', () async {
      final d = await registered();
      final e = await expiredAccess(d);
      await AccountProfileRepository(e.client).update({'name': 'Yangi'});
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['/api/v1/profile'], 2);
      expect((await AccountProfileRepository(d.client).get()).name, 'Yangi');
    });
  });

  group('real backend: colour profile', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('not analysed → a real JPEG analysis → analysed (GET), with disclaimer', () async {
      final d = await registered();
      final repo = ColorProfileRepository(d.client);
      expect(await repo.current(), isA<NotAnalysed>());
      final result = await repo.analyze(selfie());
      expect(result.profile.confidence, isNotNull);
      expect(result.disclaimer, isNotEmpty);
      expect(result.profile.recommendedColors, isNotEmpty);
      final current = await repo.current();
      expect(current, isA<Analysed>());
      final a = current as Analysed;
      expect(a.profile.season, result.profile.season);
      expect(a.profile.recommendedColors, result.profile.recommendedColors);
      expect(a.profile.confidence, isNull, reason: 'GET carries no confidence');
    });

    test('an invalid image → 422 INVALID_IMAGE; nothing stored', () async {
      final d = await registered();
      final junk = PreparedImage(
        bytes: Uint8List.fromList(List.filled(4096, 7)),
        filename: 'x.jpg',
        width: 1,
        height: 1,
      );
      expect(
        await attempt(() => ColorProfileRepository(d.client).analyze(junk)),
        failureWith(ApiErrorCode.invalidImage, 422),
      );
      expect(await ColorProfileRepository(d.client).current(), isA<NotAnalysed>());
    });

    test('isolation: one user\'s analysis never shows for another', () async {
      final a = await registered();
      await ColorProfileRepository(a.client).analyze(selfie());
      final b = await registered();
      expect(await ColorProfileRepository(b.client).current(), isA<NotAnalysed>());
    });

    test('analysis across an expired access token: refresh, then the multipart POST is re-sent once', () async {
      final d = await registered();
      final e = await expiredAccess(d);
      await ColorProfileRepository(e.client).analyze(selfie());
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['/api/v1/color-profile/analyze'], 2);
      expect(await ColorProfileRepository(d.client).current(), isA<Analysed>());
    });
  });

  group('real backend: account deletion', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('DELETE → confirmed; repeat → 404; other sessions die; login fails; media gone; others unaffected', () async {
      final email = _email();
      final a = Device();
      await a.session.restore();
      await a.session.register(email: email, password: _password);
      final b = Device(); // the same account on a second device
      await b.session.restore();
      await b.session.login(email: email, password: _password);
      final item = (await WardrobeRepository(a.client).upload(UploadJob.create(prepared()))).item;
      final mediaUrl = item.primaryImage!.url;
      final other = await registered();
      final otherItem = (await WardrobeRepository(other.client).upload(UploadJob.create(prepared()))).item;

      final c = appRun(a);
      c.listen(deleteAccountControllerProvider, (_, _) {});
      await c.read(deleteAccountControllerProvider.notifier).delete(typed: deleteConfirmationWord);
      expect(c.read(deleteAccountControllerProvider).phase, DeletePhase.deleted);
      expect(a.session.state, const Unauthenticated(SignedOutReason.accountDeleted));
      expect(a.stored, isNull, reason: 'tokens gone');
      expect(a.authAdapter.counts['/api/v1/auth/logout'], isNull, reason: 'no /auth/logout after deletion');

      // Device B: its access token is still a valid JWT, but the account is gone.
      final again = await attempt(() async {
        await b.client.callVoid((api) => api.getAccountApi().deleteAccount());
        return true;
      });
      expect(again, failureWith(ApiErrorCode.notFound, 404), reason: 'repeated DELETE → 404 = deleted');
      await Future<void>.delayed(const Duration(seconds: 11)); // B's access token expires
      await b.me();
      expect(b.session.state, isNot(isA<Authenticated>()), reason: 'B cannot refresh: every session was deleted');
      final (status, _) = await rawPost('/api/v1/auth/login', {'email': email, 'password': _password});
      expect(status, 401, reason: 'the account no longer exists');

      final media = await attempt(
        () => other.client.dio.get<List<int>>(mediaUrl, options: Options(responseType: ResponseType.bytes)),
      );
      expect(media, isA<DioException>().having((e) => e.response?.statusCode, 'status', anyOf(403, 404)));
      expect((await WardrobeRepository(other.client).get(otherItem.id)).id, otherItem.id, reason: 'others unaffected');
    });
  });
}
