import 'dart:convert';

import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/onboarding/onboarding_gate.dart';
import 'package:atlas_mobile/features/onboarding/presentation/onboarding_controller.dart';
import 'package:atlas_mobile/features/onboarding/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

const profilePath = '/api/v1/profile';

Map<String, Object?> profileJson({List<String> preferredStyles = const [], List<String> favoriteColors = const []}) => {
  'user': {
    'id': 'u1',
    'email': 'a@test.local',
    'name': null,
    'createdAt': '2026-10-01T00:00:00.000Z',
    'profile': {'id': 'p1', 'userId': 'u1'},
    'preferences': {'id': 'pr1', 'userId': 'u1', 'language': 'uz'},
  },
  'profile': {'id': 'p1', 'userId': 'u1'},
  'preferences': {
    'language': 'uz',
    'preferredStyles': preferredStyles,
    'dislikedStyles': <String>[],
    'favoriteColors': favoriteColors,
    'dislikedColors': <String>[],
  },
};

Map<String, Object?> patchOkJson() => {
  'user': {'id': 'u1', 'email': 'a@test.local', 'name': null, 'profile': null, 'preferences': null},
};

/// A container running onboarding on [h]; the session is restored first.
Future<ProviderContainer> start(SessionHarness h, {bool onboarded = false}) async {
  final container = ProviderContainer(overrides: appOverrides(h, onboarded: onboarded));
  addTearDown(container.dispose);
  final gate = container.read(onboardingGateProvider); // listens to the session from now on
  await h.session.restore();
  await settle(gate);
  return container;
}

/// Lets the gate's asynchronous check finish (fake time: no real waiting).
Future<void> settle(OnboardingGate gate) async {
  for (var i = 0; i < 50 && gate.status == OnboardingStatus.checking; i++) {
    await pumpEventQueue();
  }
}

/// Keeps the autoDispose controller alive for the test.
OnboardingController controllerOf(ProviderContainer c) {
  c.listen(onboardingControllerProvider, (_, _) {});
  return c.read(onboardingControllerProvider.notifier);
}

List<Map<String, Object?>> patches(SessionHarness h) => h.backend
    .to(profilePath)
    .where((r) => r.method == 'PATCH')
    .map((r) => jsonDecode(r.bodyText) as Map<String, Object?>)
    .toList();

void main() {
  group('gate: who sees onboarding', () {
    test('no marker and no preferences on the server → required', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.required);
      expect(h.bearers(profilePath), ['Bearer ${access(1)}']);
    });

    test('existing preferences on the server (e.g. a second device) → not required', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [
        JsonReply(200, profileJson(favoriteColors: ['navy'])),
      ]);
      final c = await start(h);
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
    });

    test('a marker for this user → not required, no server call', () async {
      final h = SessionHarness(stored: pair(1));
      final c = await start(h, onboarded: true);
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
      expect(h.backend.calls(profilePath), 0);
    });

    test('the marker is per user: another user on the same device still gets onboarding', () async {
      final h = SessionHarness();
      markOnboarded(h.kv, 'someone-else');
      h.backend.script(P.login, [JsonReply(200, pairJson(1))]);
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.none);
      await h.session.login(email: 'a@test.local', password: 'pw');
      await settle(c.read(onboardingGateProvider));
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.required);
    });

    test('profile check fails (offline) → not required: the user is never blocked', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [TransportFailure(DioExceptionType.connectionError)]);
      final c = await start(h);
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
    });

    test('unreadable marker storage → falls back to the server check', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = ProviderContainer(overrides: appOverrides(h, onboarded: false));
      addTearDown(c.dispose);
      c.read(onboardingGateProvider);
      await h.session.restore();
      h.kv.failReads = true;
      await settle(c.read(onboardingGateProvider));
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.required);
    });

    test('a token refresh does not re-run the check or change the decision', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(P.me, [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, meJson())]);
      await h.getMe();
      await pumpEventQueue();
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.required);
      expect(h.backend.calls(profilePath), 1);
    });

    test('signing out resets the decision; signing in again decides afresh', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      h.backend.script(P.logout, [
        JsonReply(200, {'ok': true}),
      ]);
      final c = await start(h);
      await h.session.logout();
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.none);
    });
  });

  group('controller', () {
    test('Finish sends exactly ONE PATCH with exactly the chosen answers, then marks completed', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.backend.handlers[profilePath] = (r) => JsonReply(200, patchOkJson());
      final ctl = controllerOf(c);
      ctl
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.minimal).toggleDislikedStyle(StyleOption.sporty))
        ..next()
        ..update((a) => a.withGender(GenderOption.male))
        ..next()
        ..update((a) => a.toggleFavoriteColor(ColorOption.olive))
        ..next();
      expect(c.read(onboardingControllerProvider).step, OnboardingStep.finish);
      await ctl.finish();

      expect(patches(h), [
        {
          'preferences': {
            'preferredStyles': ['minimal'],
            'dislikedStyles': ['sporty'],
            'favoriteColors': ['olive'],
          },
          'profile': {'gender': 'male'},
        },
      ]);
      final patch = h.backend.to(profilePath).last;
      expect(patch.header('Authorization'), 'Bearer ${access(1)}');
      expect(patch.header('X-Atlas-Client'), 'mobile');
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
      expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], 'completed');
      // Answers are not kept after completion (memory) and never stored.
      expect(c.read(onboardingControllerProvider).answers.isEmpty, isTrue);
      expect(h.kv.values.keys.toSet(), {'atlas.session.v1', OnboardingMarkerStore.keyFor('u1')});
    });

    test('nothing chosen: Finish sends no PATCH, still completes', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      final ctl = controllerOf(c);
      for (var i = 0; i < 4; i++) {
        ctl.next();
      }
      await ctl.finish();
      expect(patches(h), isEmpty);
      expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], 'completed');
    });

    test('Skip (one step) drops that step\'s answers only', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.backend.handlers[profilePath] = (r) => JsonReply(200, patchOkJson());
      final ctl = controllerOf(c);
      ctl
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.classic))
        ..next()
        ..update((a) => a.withFit(FitOption.slim))
        ..skipStep() // profile skipped: fit dropped
        ..skipStep(); // colours skipped
      expect(c.read(onboardingControllerProvider).step, OnboardingStep.finish);
      await ctl.finish();
      expect(patches(h), [
        {
          'preferences': {
            'preferredStyles': ['classic'],
          },
        },
      ]);
    });

    test('Skip all: no PATCH, answers discarded, marker "skipped"', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      final ctl = controllerOf(c);
      ctl
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.casual));
      await ctl.skipAll();
      expect(patches(h), isEmpty);
      expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], 'skipped');
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
    });

    for (final (name, reply, matcher) in [
      (
        'validation error',
        JsonReply(
          400,
          errorBody(
            'VALIDATION_ERROR',
            details: [
              {'path': 'preferences.preferredStyles', 'message': 'Noto‘g‘ri'},
            ],
          ),
        ) as FakeReply,
        isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.validationError),
      ),
      ('offline', TransportFailure(DioExceptionType.connectionError), isA<ApiUnreachableFailure>()),
      (
        'server busy',
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
        isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.sessionBusy),
      ),
      ('server error', JsonReply(500, errorBody('INTERNAL')), isA<ApiHttpFailure>()),
    ]) {
      test('save failure ($name): answers kept, retry sends the same body once more', () async {
        final h = SessionHarness(stored: pair(1));
        h.backend.script(profilePath, [JsonReply(200, profileJson())]);
        final c = await start(h);
        var patchCalls = 0;
        h.backend.handlers[profilePath] = (r) {
          patchCalls++;
          return patchCalls == 1 || (name == 'server busy' && patchCalls <= 3) ? reply : JsonReply(200, patchOkJson());
        };
        final ctl = controllerOf(c);
        ctl
          ..next()
          ..update((a) => a.togglePreferredStyle(StyleOption.bohemian))
          ..next()
          ..next()
          ..next();
        await ctl.finish();
        final failed = c.read(onboardingControllerProvider);
        expect(failed.save, SaveStatus.failed);
        expect(failed.failure, matcher);
        expect(failed.answers.preferredStyles, {StyleOption.bohemian});
        expect(failed.step, OnboardingStep.finish);
        expect(c.read(onboardingGateProvider).status, OnboardingStatus.required);
        expect(h.kv.values.containsKey(OnboardingMarkerStore.keyFor('u1')), isFalse);

        await ctl.finish(); // retry
        final sent = patches(h).map(jsonEncode).toList();
        expect(sent.toSet(), hasLength(1), reason: 'every attempt sends the same body');
        // One PATCH per Finish; SESSION_BUSY alone is repeated by the
        // transport policy (Retry-After, max 2) since it has no side effects.
        expect(sent, hasLength(name == 'server busy' ? 4 : 2));
        expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
      });
    }

    test('session ends during the save (REFRESH_REUSED): back to sign-in, no marker', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.backend.handlers[profilePath] = (r) => JsonReply(401, errorBody('UNAUTHORIZED'));
      h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
      final ctl = controllerOf(c);
      ctl
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.minimal));
      await ctl.finish();
      expect(h.session.state, const SessionExpired(SignedOutReason.reused));
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.none);
      expect(h.kv.values.containsKey(OnboardingMarkerStore.keyFor('u1')), isFalse);
    });

    test('double tap on Finish sends one PATCH', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.backend.handlers[profilePath] = (r) => JsonReply(200, patchOkJson());
      final ctl = controllerOf(c);
      ctl
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.minimal));
      await Future.wait([ctl.finish(), ctl.finish()]);
      expect(patches(h), hasLength(1));
    });

    test('a marker write failure does not block: onboarding still ends for this run', () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.script(profilePath, [JsonReply(200, profileJson())]);
      final c = await start(h);
      h.kv.failWrites = true;
      final ctl = controllerOf(c);
      await ctl.skipAll();
      expect(c.read(onboardingGateProvider).status, OnboardingStatus.notRequired);
    });
  });
}
