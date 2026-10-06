import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/profile/data/color_profile_repository.dart';
import 'package:atlas_mobile/features/profile/data/local_user_data.dart';
import 'package:atlas_mobile/features/profile/presentation/delete_account_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/profile_edit_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/selfie_analysis_controller.dart';
import 'package:atlas_mobile/features/profile/providers.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/jpeg_sanitizer.dart';
import 'package:atlas_mobile/features/wardrobe/data/pending_upload_store.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:atlas_mobile/features/weather/data/city_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import '../wardrobe/wardrobe_fixtures.dart';
import 'profile_fixtures.dart';

/// A compressor that honours the requested size: the output's frame says
/// the scaled dimensions (and carries device metadata to be stripped).
class ScalingCompressor implements ImageCompressor {
  ScalingCompressor(this.width, this.height);
  final int width;
  final int height;
  final requested = <int?>[];

  @override
  Future<Uint8List> toJpeg(Uint8List source, {required int quality, int? targetShortestSide}) async {
    requested.add(targetShortestSide);
    var w = width;
    var h = height;
    if (targetShortestSide != null) {
      final shortest = w < h ? w : h;
      w = (w * targetShortestSide / shortest).round();
      h = (h * targetShortestSide / shortest).round();
    }
    return withDeviceMetadata(withFrameSize(fixtureBytes('plain_landscape.jpg'), w, h));
  }
}

class Profile {
  Profile({ImageCompressor? compressor, FakePicker? picker})
    : picker = picker ?? FakePicker(result: photo('selfie.jpg')) {
    c = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(this.picker),
        imagePreparerProvider.overrideWithValue(ImagePreparer(compressor ?? StubCompressor())),
      ],
    );
    addTearDown(c.dispose);
    h.backend.handlers[P.profile] = (r) =>
        r.method == 'GET' ? profileReply : patchReplies[(patches++).clamp(0, patchReplies.length - 1)];
    h.backend.script(P.colorProfile, [JsonReply(200, notAnalysedJson())]);
    h.backend.script(P.analyze, [JsonReply(200, analysisJson())]);
    h.backend.script(P.account, [
      JsonReply(200, {'ok': true}),
    ]);
  }

  final h = SessionHarness(stored: pair(1));
  final FakePicker picker;
  late final ProviderContainer c;
  FakeReply profileReply = JsonReply(200, profileJson());
  var patchReplies = <FakeReply>[JsonReply(200, patchResponseJson())];
  var patches = 0;

  List<SentRequest> get patchRequests => h.backend.to(P.profile).where((r) => r.method == 'PATCH').toList();
  List<SentRequest> get profileReads => h.backend.to(P.profile).where((r) => r.method == 'GET').toList();

  Future<void> start() async {
    await h.session.restore();
  }

  Future<ProfileEditController> editor() async {
    c.listen(profileEditControllerProvider, (_, _) {});
    for (var i = 0; i < 20 && c.read(profileEditControllerProvider).status == ProfileEditStatus.loading; i++) {
      await pumpEventQueue();
    }
    return c.read(profileEditControllerProvider.notifier);
  }

  ProfileEditState get edit => c.read(profileEditControllerProvider);
}

void main() {
  // Deletion clears the in-memory image cache (always present in the app).
  TestWidgetsFlutterBinding.ensureInitialized();

  group('profile edit', () {
    test('GET → draft; one PATCH with the exact changes; then GET again (server truth)', () async {
      final p = Profile();
      await p.start();
      final e = await p.editor();
      expect(p.edit.original!.name, 'Aziza');
      expect(p.edit.original!.favoriteColors, {ColorOption.navy, ColorOption.white});
      p.profileReply = JsonReply(200, profileJson(name: 'Dilnoza', favoriteColors: const ['navy']));
      e.edit((d) => d.withName(' Dilnoza ').toggleFavoriteColor(ColorOption.white));
      await e.save();
      expect(p.patchRequests.map((r) => jsonDecode(r.bodyText)), [
        {
          'name': 'Dilnoza',
          'preferences': {
            'favoriteColors': ['navy'],
          },
        },
      ]);
      expect(p.profileReads, hasLength(2), reason: 'load + re-read after the save');
      expect(p.edit.status, ProfileEditStatus.saved);
      expect(p.edit.original!.name, 'Dilnoza');
      expect(p.c.read(profileProvider).profile!.name, 'Dilnoza', reason: 'the profile tab shows server truth');
    });

    test('nothing changed → no request', () async {
      final p = Profile();
      await p.start();
      final e = await p.editor();
      await e.save();
      expect(p.edit.status, ProfileEditStatus.saved);
      expect(p.patchRequests, isEmpty);
    });

    test('invalid draft (name cleared) → nothing sent', () async {
      final p = Profile();
      await p.start();
      final e = await p.editor();
      e.edit((d) => d.withName('  '));
      await e.save();
      expect(p.patchRequests, isEmpty);
    });

    test('failure → edits kept; Retry sends the same body once; never automatically', () async {
      final p = Profile()
        ..patchReplies = [TransportFailure(DioExceptionType.connectionError), JsonReply(200, patchResponseJson())];
      await p.start();
      final e = await p.editor();
      e.edit((d) => d.togglePreferredStyle(StyleOption.minimal));
      await e.save();
      expect(p.edit.status, ProfileEditStatus.failed);
      expect(p.edit.draft!.preferredStyles, contains(StyleOption.minimal));
      expect(p.patchRequests, hasLength(1));
      await e.save();
      expect(p.edit.status, ProfileEditStatus.saved);
      expect(p.patchRequests.map((r) => r.bodyText).toSet(), hasLength(1), reason: 'same body');
    });

    test('double tap → one PATCH', () async {
      final p = Profile();
      await p.start();
      final e = await p.editor();
      e.edit((d) => d.withName('Dilnoza'));
      p.h.backend.gates[P.profile] = Gate();
      final a = e.save();
      final b = e.save();
      await pumpEventQueue();
      p.h.backend.gates[P.profile]!.open();
      await Future.wait([a, b]);
      expect(p.patchRequests, hasLength(1));
    });

    test('401 → refresh → the PATCH is re-sent once', () async {
      final p = Profile()
        ..patchReplies = [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, patchResponseJson())];
      await p.start();
      final e = await p.editor();
      p.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      e.edit((d) => d.withName('Dilnoza'));
      await e.save();
      expect(p.edit.status, ProfileEditStatus.saved);
      expect(p.patchRequests.map((r) => r.header('Authorization')), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    });

    test('a terminal session error discards the edits', () async {
      final p = Profile()..patchReplies = [JsonReply(401, errorBody('UNAUTHORIZED'))];
      await p.start();
      final e = await p.editor();
      p.h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_REVOKED'))]);
      e.edit((d) => d.withName('Dilnoza'));
      await e.save();
      expect(p.edit.status, ProfileEditStatus.loadFailed);
      expect(p.edit.draft, isNull);
    });

    test('the generated contract hides the body fields (gender, height, fit): never read, never sent', () async {
      final p = Profile();
      await p.start();
      final e = await p.editor();
      e.edit((d) => d.withName('Dilnoza'));
      await e.save();
      final body = jsonDecode(p.patchRequests.single.bodyText) as Map;
      expect(body.containsKey('profile'), isFalse);
    });
  });

  group('selfie preparation', () {
    test('a 4000×3000 photo becomes a JPEG ≤ 1024 px with EXIF/GPS stripped', () async {
      final compressor = ScalingCompressor(4000, 3000);
      final source = withFrameSize(fixtureBytes('plain_landscape.jpg'), 4000, 3000);
      final prepared = await ImagePreparer(compressor).prepare(source, maxSide: selfieMaxSide);
      expect(prepared.width, lessThanOrEqualTo(1024));
      expect(prepared.height, lessThanOrEqualTo(1024));
      expect(prepared.width > prepared.height ? prepared.width : prepared.height, 1024);
      expect(prepared.bytes.sublist(0, 2), [0xFF, 0xD8], reason: 'JPEG');
      expect(JpegSanitizer.strip(prepared.bytes), prepared.bytes, reason: 'nothing left to strip');
      expect(containsBytes(prepared.bytes, 'GPS'.codeUnits), isFalse);
      expect(containsBytes(prepared.bytes, 'Exif'.codeUnits), isFalse);
    });

    test('the default (wardrobe) cap stays 4096', () async {
      final compressor = ScalingCompressor(5000, 2500);
      final source = withFrameSize(fixtureBytes('plain_landscape.jpg'), 5000, 2500);
      final prepared = await ImagePreparer(compressor).prepare(source);
      expect(prepared.width, 4096);
      expect(compressor.requested.first, 2048);
    });
  });

  group('selfie analysis', () {
    Future<(Profile, SelfieAnalysisController)> start({FakePicker? picker}) async {
      final p = Profile(picker: picker);
      await p.start();
      p.c.listen(selfieAnalysisControllerProvider, (_, _) {});
      return (p, p.c.read(selfieAnalysisControllerProvider.notifier));
    }

    SelfieAnalysisState of(Profile p) => p.c.read(selfieAnalysisControllerProvider);

    test('consent first: nothing is picked until the user chooses; camera prefers the front camera', () async {
      final (p, s) = await start();
      expect(of(p).phase, SelfiePhase.consent);
      expect(p.picker.calls, isEmpty);
      await s.pick(PhotoSource.camera);
      expect(p.picker.calls, [PhotoSource.camera]);
      expect(p.picker.front, [true]);
    });

    test('success: ONE multipart POST of a JPEG; the result (with confidence) is shown and becomes current', () async {
      final (p, s) = await start();
      await s.pick(PhotoSource.gallery);
      expect(p.picker.front, [false]);
      expect(of(p).phase, SelfiePhase.done);
      expect(of(p).result!.profile.confidence, 0.82);
      final post = p.h.backend.to(P.analyze).single;
      expect(post.header('Content-Type').toString(), startsWith('multipart/form-data'));
      expect(post.bodyText, contains('image/jpeg'));
      expect(p.c.read(colorProfileProvider).current, isA<Analysed>());
    });

    test('lost answer → UNKNOWN: no re-send; GET /color-profile once; server truth shown as such', () async {
      final (p, s) = await start();
      p.h.backend.script(P.analyze, [TransportFailure(DioExceptionType.receiveTimeout)]);
      p.h.backend.script(P.colorProfile, [
        JsonReply(200, analysedJson(season: 'winter', analyzedAt: '2026-09-01T10:00:00.000Z')),
      ]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.unknown);
      expect(p.h.backend.calls(P.analyze), 1);
      expect(p.h.backend.calls(P.colorProfile), 1);
      final current = of(p).serverCurrent! as Analysed;
      expect(current.profile.season, 'winter');
      expect(of(p).result, isNull, reason: 'never claimed as this attempt');
      expect(of(p).hasImage, isTrue);
      await s.analyse(); // explicit
      expect(p.h.backend.calls(P.analyze), 2);
    });

    test('5xx → unknown; 422 → rejected (new photo); 4xx → failed with an explicit retry', () async {
      final (p, s) = await start();
      p.h.backend.script(P.analyze, [JsonReply(500, errorBody('INTERNAL'))]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.unknown);
      s.restart();
      p.h.backend.script(P.analyze, [JsonReply(422, errorBody('INVALID_IMAGE'))]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.rejected);
      s.restart();
      p.h.backend.script(P.analyze, [JsonReply(400, errorBody('BAD_REQUEST')), JsonReply(200, analysisJson())]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.failed);
      await s.analyse();
      expect(of(p).phase, SelfiePhase.done);
    });

    test('401 → refresh → the analysis is re-sent once', () async {
      final (p, s) = await start();
      p.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      p.h.backend.script(P.analyze, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, analysisJson())]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.done);
      expect(p.h.bearers(P.analyze), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    });

    test('double tap → one POST', () async {
      final (p, s) = await start();
      p.h.backend.gates[P.analyze] = Gate();
      final a = s.pick(PhotoSource.gallery);
      final b = s.pick(PhotoSource.gallery);
      await pumpEventQueue();
      p.h.backend.gates[P.analyze]!.open();
      await Future.wait([a, b]);
      expect(p.h.backend.calls(P.analyze), 1);
    });

    test('permission denied → back to consent with an explanation; nothing sent', () async {
      final (p, s) = await start(picker: FakePicker(denied: true));
      await s.pick(PhotoSource.camera);
      expect(of(p).phase, SelfiePhase.consent);
      expect(of(p).denied, PhotoSource.camera);
      expect(p.h.backend.calls(P.analyze), 0);
    });

    test('an unreadable photo → rejected before upload', () async {
      final (p, s) = await start(
        picker: FakePicker(result: PickedPhoto(Uint8List.fromList(List.filled(64, 1)), 'x.jpg')),
      );
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.rejected);
      expect(p.h.backend.calls(P.analyze), 0);
    });
  });

  group('account deletion', () {
    Future<(Profile, DeleteAccountController)> start() async {
      final p = Profile();
      await p.start();
      // Per-user data of u1 and of another user on this device.
      for (final u in ['u1', 'u2']) {
        p.h.kv.values[OnboardingMarkerStore.keyFor(u)] = 'completed';
        p.h.kv.values[PendingUploadStore.keyFor(u)] = 'r';
        p.h.kv.values[CityStore.keyFor(u)] = 'tashkent';
      }
      p.c.listen(deleteAccountControllerProvider, (_, _) {});
      return (p, p.c.read(deleteAccountControllerProvider.notifier));
    }

    DeleteAccountState of(Profile p) => p.c.read(deleteAccountControllerProvider);

    Map<String, String> left(Profile p) => Map.of(p.h.kv.values);

    test('the typed confirmation must match; otherwise nothing is sent', () async {
      final (p, d) = await start();
      await d.delete(typed: 'ochirish');
      await d.delete();
      expect(p.h.backend.calls(P.account), 0);
      expect(DeleteAccountController.confirmationMatches(' o‘chirish '), isTrue);
    });

    test(
      '200 → deleted: tokens + this user\'s keys removed, another user\'s kept; signed out WITHOUT /auth/logout',
      () async {
        final (p, d) = await start();
        await d.delete(typed: 'O‘CHIRISH');
        expect(p.h.backend.calls(P.account), 1);
        expect(p.h.backend.calls(P.logout), 0);
        expect(p.h.session.state, const Unauthenticated(SignedOutReason.accountDeleted));
        expect(p.h.kv.stored, isNull, reason: 'tokens gone');
        expect(left(p).keys.toSet(), LocalUserData.keysFor('u2').toSet(), reason: 'only u2 data remains');
      },
    );

    test('404 → already deleted = deleted', () async {
      final (p, d) = await start();
      p.h.backend.script(P.account, [JsonReply(404, errorBody('NOT_FOUND'))]);
      await d.delete(typed: 'O‘CHIRISH');
      expect(p.h.session.state, const Unauthenticated(SignedOutReason.accountDeleted));
      expect(left(p).keys.toSet(), LocalUserData.keysFor('u2').toSet());
    });

    test('lost answer → UNKNOWN: nothing claimed or cleared; "Tekshirish" re-sends; 404 confirms', () async {
      final (p, d) = await start();
      p.h.backend.script(P.account, [
        TransportFailure(DioExceptionType.receiveTimeout),
        JsonReply(404, errorBody('NOT_FOUND')),
      ]);
      await d.delete(typed: 'O‘CHIRISH');
      expect(of(p).phase, DeletePhase.unknown);
      expect(p.h.session.state, isA<Authenticated>());
      expect(left(p).keys, containsAll(LocalUserData.keysFor('u1')));
      expect(p.h.backend.calls(P.account), 1, reason: 'no automatic retry');
      await d.delete(); // Tekshirish (no typing needed)
      expect(p.h.backend.calls(P.account), 2);
      expect(p.h.session.state, const Unauthenticated(SignedOutReason.accountDeleted));
    });

    test('5xx → unknown; 403 → failed (nothing deleted locally)', () async {
      final (p, d) = await start();
      p.h.backend.script(P.account, [JsonReply(500, errorBody('INTERNAL'))]);
      await d.delete(typed: 'O‘CHIRISH');
      expect(of(p).phase, DeletePhase.unknown);
      final (q, e) = await start();
      q.h.backend.script(P.account, [JsonReply(403, errorBody('FORBIDDEN'))]);
      await e.delete(typed: 'O‘CHIRISH');
      expect(of(q).phase, DeletePhase.failed);
      expect(q.h.session.state, isA<Authenticated>());
      expect(left(q).keys, containsAll(LocalUserData.keysFor('u1')));
    });

    test('double tap → one DELETE', () async {
      final (p, d) = await start();
      p.h.backend.gates[P.account] = Gate();
      final a = d.delete(typed: 'O‘CHIRISH');
      final b = d.delete(typed: 'O‘CHIRISH');
      await pumpEventQueue();
      p.h.backend.gates[P.account]!.open();
      await Future.wait([a, b]);
      expect(p.h.backend.calls(P.account), 1);
    });

    test('the session cannot be renewed during deletion → nothing claimed; sign-in says it may be deleted', () async {
      final (p, d) = await start();
      p.h.backend.script(P.account, [JsonReply(401, errorBody('UNAUTHORIZED'))]);
      p.h.backend.script(P.refresh, [JsonReply(401, errorBody('INVALID_TOKEN'))]);
      await d.delete(typed: 'O‘CHIRISH');
      expect(p.c.read(accountMaybeDeletedProvider), isTrue);
      expect(left(p).keys, containsAll(LocalUserData.keysFor('u1')), reason: 'not confirmed: not cleared');
    });
  });

  test('session: endAfterAccountDeletion clears the tokens without /auth/logout', () async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    await h.session.endAfterAccountDeletion();
    expect(h.session.state, const Unauthenticated(SignedOutReason.accountDeleted));
    expect(h.kv.stored, isNull);
    expect(h.backend.calls(P.logout), 0);
  });

  group('Phase 4.3 colour profile', () {
    Future<(Profile, SelfieAnalysisController)> start() async {
      final p = Profile();
      await p.start();
      p.c.listen(selfieAnalysisControllerProvider, (_, _) {});
      p.c.listen(colorProfileProvider, (_, _) {});
      return (p, p.c.read(selfieAnalysisControllerProvider.notifier));
    }

    SelfieAnalysisState of(Profile p) => p.c.read(selfieAnalysisControllerProvider);

    test('the analysis result carries undertone confidence and the secondary season', () async {
      final (p, s) = await start();
      p.h.backend.script(P.analyze, [
        JsonReply(200, {
          'colorProfile': {
            ...colorCore(season: 'spring'),
            'undertone': 'neutral_warm',
            'confidence': 0.62,
            'undertoneConfidence': 0.55,
            'secondarySeason': 'autumn',
            'secondaryConfidence': 0.21,
          },
          'disclaimer': disclaimer,
        }),
      ]);
      await s.pick(PhotoSource.gallery);
      final r = of(p).result!.profile;
      expect((r.season, r.undertone, r.confidence), ('spring', 'neutral_warm', 0.62));
      expect((r.undertoneConfidence, r.secondarySeason, r.secondaryConfidence), (0.55, 'autumn', 0.21));
    });

    test('GET carries the confidences too (null for profiles from before Phase 4.3)', () async {
      final p = Profile();
      p.h.backend.script(P.colorProfile, [
        JsonReply(200, {
          'status': 'analyzed',
          'colorProfile': {
            ...colorCore(),
            'confidence': 0.4,
            'undertoneConfidence': null,
            'secondarySeason': null,
            'secondaryConfidence': null,
          },
          'disclaimer': disclaimer,
        }),
      ]);
      await p.h.session.restore();
      final current = await p.c.read(colorProfileRepositoryProvider).current() as Analysed;
      expect(current.profile.confidence, 0.4);
      expect(current.profile.secondarySeason, isNull);
    });

    for (final (code, reason) in [
      ('PHOTO_QUALITY_TOO_LOW', 'blurry'),
      ('PHOTO_QUALITY_TOO_LOW', 'too_dark'),
      ('SKIN_NOT_VISIBLE', null),
    ]) {
      test('422 $code ${reason ?? ''} → rejected (a new photo is needed), nothing re-sent', () async {
        final (p, s) = await start();
        p.h.backend.script(P.analyze, [
          JsonReply(
            422,
            errorBody(
              code,
              details: reason == null
                  ? null
                  : [
                      {'path': 'reason', 'message': reason},
                    ],
            ),
          ),
        ]);
        await s.pick(PhotoSource.gallery);
        expect(of(p).phase, SelfiePhase.rejected);
        expect(of(p).hasImage, isFalse);
        expect(p.h.backend.calls(P.analyze), 1);
      });
    }

    test('503 ANALYSIS_UNAVAILABLE → failed (nothing was stored): the same photo can be retried explicitly', () async {
      final (p, s) = await start();
      p.h.backend.script(P.analyze, [
        JsonReply(503, errorBody('ANALYSIS_UNAVAILABLE')),
        JsonReply(200, analysisJson()),
      ]);
      await s.pick(PhotoSource.gallery);
      expect(of(p).phase, SelfiePhase.failed);
      expect(of(p).hasImage, isTrue);
      expect(p.h.backend.calls(P.colorProfile), 1, reason: 'no "unknown" check: the server said nothing was stored');
      await s.analyse();
      expect(of(p).phase, SelfiePhase.done);
    });

    test('delete → DELETE /color-profile once; the screen state becomes "not analysed"', () async {
      final p = Profile();
      p.h.backend.script(P.colorProfile, [
        JsonReply(200, analysedJson()),
        JsonReply(200, {'ok': true}),
      ]);
      await p.start();
      p.c.listen(colorProfileProvider, (_, _) {});
      for (var i = 0; i < 20 && p.c.read(colorProfileProvider).current is! Analysed; i++) {
        await pumpEventQueue();
      }
      await p.c.read(colorProfileProvider.notifier).delete();
      final deletes = p.h.backend.to(P.colorProfile).where((r) => r.method == 'DELETE');
      expect(deletes, hasLength(1));
      expect(p.c.read(colorProfileProvider).current, isA<NotAnalysed>());
    });

    test('a failed delete keeps the profile shown, with the error', () async {
      final p = Profile();
      p.h.backend.script(P.colorProfile, [JsonReply(200, analysedJson()), JsonReply(500, errorBody('INTERNAL'))]);
      await p.start();
      p.c.listen(colorProfileProvider, (_, _) {});
      for (var i = 0; i < 20 && p.c.read(colorProfileProvider).current is! Analysed; i++) {
        await pumpEventQueue();
      }
      await p.c.read(colorProfileProvider.notifier).delete();
      expect(p.c.read(colorProfileProvider).current, isA<Analysed>());
      expect(p.c.read(colorProfileProvider).failure, isNotNull);
    });
  });
}
