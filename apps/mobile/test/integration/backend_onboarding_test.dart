// Real-backend integration for onboarding: register → onboarding → GET
// /profile. Skipped unless ATLAS_IT_BASE_URL is set (local, disposable
// backend only — see backend_session_test.dart).
import 'dart:io';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:atlas_mobile/core/session/providers.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/onboarding/onboarding_gate.dart';
import 'package:atlas_mobile/features/onboarding/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import '../support/fake_session.dart' show MemorySecureStore;
import 'backend_session_test.dart' show Device, registered;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];

ProviderContainer containerFor(Device d) {
  final c = ProviderContainer(
    overrides: [
      environmentConfigProvider.overrideWithValue(
        AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: _base!),
      ),
      deviceNetworkProvider.overrideWithValue(FakeNetwork()),
      sessionControllerProvider.overrideWithValue(d.session),
      secureKeyValueStoreProvider.overrideWithValue(d.kv),
      atlasApiClientProvider.overrideWithValue(d.client),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

Future<void> settle(OnboardingGate gate) async {
  for (var i = 0; i < 200 && gate.status == OnboardingStatus.checking; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() {
  group('real backend: onboarding', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('register → onboarding required → Finish (one PATCH) → GET /profile has the answers', () async {
      final d = Device();
      final c = containerFor(d);
      final gate = c.read(onboardingGateProvider);
      await d.session.restore();
      await d.session.register(
        email: 'onb-${DateTime.now().microsecondsSinceEpoch}@test.local',
        password: 'it-password-123',
      );
      await settle(gate);
      expect(gate.status, OnboardingStatus.required, reason: 'a new account has no preferences');

      c.listen(onboardingControllerProvider, (_, _) {});
      final ctl = c.read(onboardingControllerProvider.notifier)
        ..next()
        ..update((a) => a.togglePreferredStyle(StyleOption.smartCasual).toggleDislikedStyle(StyleOption.sporty))
        ..next()
        ..update((a) => a.withGender(GenderOption.unisex).withFit(FitOption.relaxed))
        ..next()
        ..update((a) => a.toggleFavoriteColor(ColorOption.lightBlue).toggleDislikedColor(ColorOption.mustard))
        ..next();
      await ctl.finish();
      expect(gate.status, OnboardingStatus.notRequired);
      expect(d.kv.values[OnboardingMarkerStore.keyFor(d.stored!.user.id)], 'completed');
      expect(d.apiAdapter.counts['/api/v1/profile'], 2, reason: 'GET (check) + exactly one PATCH');

      final profile = await d.client.call((api) => api.getProfileApi().getProfile());
      final p = profile.preferences!;
      expect(p.preferredStyles.toList(), ['smart_casual']);
      expect(p.dislikedStyles.toList(), ['sporty']);
      expect(p.favoriteColors.toList(), ['light_blue']);
      expect(p.dislikedColors.toList(), ['mustard']);
      expect(p.language, 'uz', reason: 'not touched by onboarding');
    });

    test('Skip all → no PATCH; the same account on a new device is asked again (marker is per device)', () async {
      final d = await registered();
      final c = containerFor(d);
      final gate = c.read(onboardingGateProvider);
      await settle(gate);
      expect(gate.status, OnboardingStatus.required);
      c.listen(onboardingControllerProvider, (_, _) {});
      await c.read(onboardingControllerProvider.notifier).skipAll();
      expect(d.apiAdapter.counts['/api/v1/profile'], 1, reason: 'only the GET check');

      final other = Device(kv: MemorySecureStore()..put(d.stored!));
      final c2 = containerFor(other);
      final gate2 = c2.read(onboardingGateProvider);
      await other.session.restore();
      await settle(gate2);
      expect(gate2.status, OnboardingStatus.required);
    });

    test('an account that already has preferences is not asked on another device', () async {
      final d = await registered();
      final c = containerFor(d);
      c.read(onboardingGateProvider);
      await c.read(profileRepositoryProvider).update({
        'preferences': {
          'favoriteColors': ['navy'],
        },
      });
      final other = Device(kv: MemorySecureStore()..put(d.stored!));
      final c2 = containerFor(other);
      final gate2 = c2.read(onboardingGateProvider);
      await other.session.restore();
      await settle(gate2);
      expect(gate2.status, OnboardingStatus.notRequired);
    });
  });
}
