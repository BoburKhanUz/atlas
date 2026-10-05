import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import '../../core/session/providers.dart';
import 'data/onboarding_marker_store.dart';
import 'data/profile_repository.dart';
import 'onboarding_gate.dart';
import 'presentation/onboarding_controller.dart';

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => ProfileRepository(ref.watch(atlasApiClientProvider)),
);

final onboardingMarkerStoreProvider = Provider<OnboardingMarkerStore>(
  (ref) => OnboardingMarkerStore(ref.watch(secureKeyValueStoreProvider)),
);

final onboardingGateProvider = Provider<OnboardingGate>((ref) {
  final repository = ref.watch(profileRepositoryProvider);
  final gate = OnboardingGate(
    session: ref.watch(sessionControllerProvider),
    markers: ref.watch(onboardingMarkerStoreProvider),
    hasStylePreferences: repository.hasStylePreferences,
  );
  ref.onDispose(gate.dispose);
  return gate;
});

/// Disposed with the onboarding screen: answers never outlive it.
final onboardingControllerProvider = NotifierProvider.autoDispose<OnboardingController, OnboardingDraft>(
  OnboardingController.new,
);
