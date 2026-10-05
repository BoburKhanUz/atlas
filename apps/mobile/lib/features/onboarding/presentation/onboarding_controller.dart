import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../data/onboarding_answers.dart';
import '../data/onboarding_marker_store.dart';
import '../providers.dart';

enum OnboardingStep { welcome, style, profile, colors, finish }

enum SaveStatus { idle, saving, failed }

@immutable
class OnboardingDraft {
  const OnboardingDraft({
    this.step = OnboardingStep.welcome,
    this.answers = const OnboardingAnswers(),
    this.save = SaveStatus.idle,
    this.failure,
  });

  final OnboardingStep step;
  final OnboardingAnswers answers;
  final SaveStatus save;

  /// The last save failure (shown with a retry button).
  final ApiFailure? failure;

  OnboardingDraft copyWith({OnboardingStep? step, OnboardingAnswers? answers, SaveStatus? save, ApiFailure? failure}) =>
      OnboardingDraft(
        step: step ?? this.step,
        answers: answers ?? this.answers,
        save: save ?? this.save,
        failure: failure,
      );
}

/// Onboarding screen state. Answers stay in memory (this provider is
/// disposed with the screen) and are sent once, on Finish.
class OnboardingController extends Notifier<OnboardingDraft> {
  @override
  OnboardingDraft build() => const OnboardingDraft();

  void update(OnboardingAnswers Function(OnboardingAnswers a) change) {
    if (state.save == SaveStatus.saving) return;
    state = state.copyWith(answers: change(state.answers));
  }

  void next() {
    final i = state.step.index;
    if (i < OnboardingStep.values.length - 1) state = state.copyWith(step: OnboardingStep.values[i + 1]);
  }

  void back() {
    final i = state.step.index;
    if (i > 0 && state.save != SaveStatus.saving) state = state.copyWith(step: OnboardingStep.values[i - 1]);
  }

  /// Skip the current step: its answers are dropped (nothing is sent for it).
  void skipStep() {
    final a = state.answers;
    final cleared = switch (state.step) {
      OnboardingStep.style => a.clearStyles(),
      OnboardingStep.profile => a.clearProfile(),
      OnboardingStep.colors => a.clearColors(),
      OnboardingStep.welcome || OnboardingStep.finish => a,
    };
    state = state.copyWith(answers: cleared);
    next();
  }

  /// Leave onboarding without sending anything.
  Future<void> skipAll() async {
    if (state.save == SaveStatus.saving) return;
    state = const OnboardingDraft();
    await ref.read(onboardingGateProvider).markDone(OnboardingMarker.skipped);
  }

  /// Sends the answers in ONE PATCH /api/v1/profile (nothing when empty).
  /// On failure the answers stay for a retry.
  Future<void> finish() async {
    if (state.save == SaveStatus.saving) return;
    final patch = state.answers.toPatchJson();
    if (patch != null) {
      state = state.copyWith(save: SaveStatus.saving);
      try {
        await ref.read(profileRepositoryProvider).update(patch);
      } on SessionEndedFailure {
        // The auth state already moved to sign-in; the router leaves.
        if (ref.mounted) state = state.copyWith(save: SaveStatus.idle);
        return;
      } on ApiFailure catch (f) {
        AppLog.warn('onboarding save failed: ${f.describe()}');
        if (ref.mounted) state = state.copyWith(save: SaveStatus.failed, failure: f);
        return;
      }
    }
    if (!ref.mounted) return;
    state = const OnboardingDraft(); // answers are not kept after completion
    await ref.read(onboardingGateProvider).markDone(OnboardingMarker.completed);
  }
}
