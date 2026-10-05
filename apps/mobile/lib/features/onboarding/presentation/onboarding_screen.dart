import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../data/options.dart';
import '../onboarding_gate.dart';
import '../providers.dart';
import 'onboarding_controller.dart';
import 'option_chips.dart';

/// Welcome → style → profile → colours → finish. Every step after the
/// welcome is optional; "Skip all" leaves at any time. Nothing is sent
/// until Finish.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final draft = ref.watch(onboardingControllerProvider);
    final controller = ref.read(onboardingControllerProvider.notifier);
    final saving = draft.save == SaveStatus.saving;
    final step = draft.step;
    final total = OnboardingStep.values.length;

    return PopScope(
      canPop: step == OnboardingStep.welcome,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) controller.back();
      },
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AtlasSpacing.xs, AtlasSpacing.xs, AtlasSpacing.xs, 0),
                child: Row(
                  children: [
                    SizedBox.square(
                      dimension: kAtlasMinTouchTarget,
                      child: step == OnboardingStep.welcome
                          ? null
                          : IconButton(
                              key: const Key('onboarding.back'),
                              tooltip: 'Orqaga',
                              onPressed: saving ? null : controller.back,
                              icon: const Icon(Icons.arrow_back_rounded),
                            ),
                    ),
                    Expanded(
                      child: Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: TextButton(
                          key: const Key('onboarding.skipAll'),
                          onPressed: saving || step == OnboardingStep.finish ? null : controller.skipAll,
                          child: const Text('O‘tkazib yuborish', maxLines: 1, overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
                child: Semantics(
                  label: 'Qadam ${step.index + 1} / $total',
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(AtlasRadii.pill),
                    child: LinearProgressIndicator(value: (step.index + 1) / total, minHeight: 4),
                  ),
                ),
              ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: AtlasMotion.of(context, AtlasMotion.normal),
                  child: SingleChildScrollView(
                    key: ValueKey(step),
                    padding: const EdgeInsets.fromLTRB(
                      AtlasSpacing.screen,
                      AtlasSpacing.lg,
                      AtlasSpacing.screen,
                      AtlasSpacing.lg,
                    ),
                    child: _StepBody(step: step, draft: draft, enabled: !saving),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AtlasSpacing.screen,
                  AtlasSpacing.xs,
                  AtlasSpacing.screen,
                  AtlasSpacing.md,
                ),
                child: _Actions(step: step, saving: saving),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StepBody extends ConsumerWidget {
  const _StepBody({required this.step, required this.draft, required this.enabled});
  final OnboardingStep step;
  final OnboardingDraft draft;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final c = ref.read(onboardingControllerProvider.notifier);
    final a = draft.answers;
    Widget header(String title, String subtitle) => Padding(
      padding: const EdgeInsets.only(bottom: AtlasSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: text.headlineMedium),
          const SizedBox(height: AtlasSpacing.xs),
          Text(subtitle, style: text.bodyMedium),
        ],
      ),
    );

    return switch (step) {
      OnboardingStep.welcome => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('ATLAS', style: text.titleMedium?.copyWith(letterSpacing: 4, color: AtlasColors.accent)),
          const SizedBox(height: AtlasSpacing.lg),
          header(
            'Shaxsiy stilistingizga xush kelibsiz',
            'Bir necha savol — tavsiyalar sizning didingizga mos bo‘ladi. Har bir qadamni o‘tkazib yuborish mumkin.',
          ),
        ],
      ),
      OnboardingStep.style => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header('Uslubingiz', 'Qaysi uslublar sizga yoqadi va qaysilari yoqmaydi?'),
          StepSection(
            title: 'Yoqadi',
            child: OptionChips<StyleOption>(
              keyPrefix: 'style.like',
              options: StyleOption.values,
              label: (o) => o.label,
              isSelected: a.preferredStyles.contains,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.togglePreferredStyle(o)),
            ),
          ),
          StepSection(
            title: 'Yoqmaydi',
            child: OptionChips<StyleOption>(
              keyPrefix: 'style.dislike',
              options: StyleOption.values,
              label: (o) => o.label,
              isSelected: a.dislikedStyles.contains,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.toggleDislikedStyle(o)),
            ),
          ),
        ],
      ),
      OnboardingStep.profile => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header('Siz uchun', 'Kiyimlar qaysi yo‘nalishda tanlansin va qanday o‘lchamda yoqadi?'),
          StepSection(
            title: 'Yo‘nalish',
            child: OptionChips<GenderOption>(
              keyPrefix: 'profile.gender',
              options: GenderOption.values,
              label: (o) => o.label,
              isSelected: (o) => a.gender == o,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.withGender(o)),
            ),
          ),
          StepSection(
            title: 'Bichim',
            child: OptionChips<FitOption>(
              keyPrefix: 'profile.fit',
              options: FitOption.values,
              label: (o) => o.label,
              isSelected: (o) => a.fit == o,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.withFit(o)),
            ),
          ),
        ],
      ),
      OnboardingStep.colors => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header('Ranglar', 'Sevimli ranglaringizni va kiymaydigan ranglaringizni belgilang.'),
          StepSection(
            title: 'Yoqadi',
            child: OptionChips<ColorOption>(
              keyPrefix: 'color.like',
              options: ColorOption.values,
              label: (o) => o.label,
              swatch: (o) => o.swatch,
              isSelected: a.favoriteColors.contains,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.toggleFavoriteColor(o)),
            ),
          ),
          StepSection(
            title: 'Yoqmaydi',
            child: OptionChips<ColorOption>(
              keyPrefix: 'color.dislike',
              options: ColorOption.values,
              label: (o) => o.label,
              swatch: (o) => o.swatch,
              isSelected: a.dislikedColors.contains,
              enabled: enabled,
              onToggle: (o) => c.update((x) => x.toggleDislikedColor(o)),
            ),
          ),
          Text(
            'Selfi orqali rang tahlili keyinroq Profil bo‘limida bo‘ladi.',
            style: text.bodySmall?.copyWith(color: AtlasColors.textSecondary),
          ),
        ],
      ),
      OnboardingStep.finish => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header(
            'Hammasi tayyor',
            a.isEmpty
                ? 'Afzalliklarni keyinroq Profil bo‘limida belgilashingiz mumkin.'
                : 'Tanlovlaringiz saqlanadi va tavsiyalarda hisobga olinadi.',
          ),
          if (draft.save == SaveStatus.failed && draft.failure != null)
            Semantics(
              liveRegion: true,
              child: Container(
                key: const Key('onboarding.error'),
                padding: const EdgeInsets.all(AtlasSpacing.sm),
                decoration: const BoxDecoration(color: AtlasColors.errorSoft, borderRadius: AtlasRadii.field),
                child: Text(draft.failure!.userMessage, style: const TextStyle(color: AtlasColors.error)),
              ),
            ),
        ],
      ),
    };
  }
}

class _Actions extends ConsumerWidget {
  const _Actions({required this.step, required this.saving});
  final OnboardingStep step;
  final bool saving;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.read(onboardingControllerProvider.notifier);
    final failed = ref.watch(onboardingControllerProvider.select((d) => d.save == SaveStatus.failed));
    final optional = step == OnboardingStep.style || step == OnboardingStep.profile || step == OnboardingStep.colors;
    if (step == OnboardingStep.finish) {
      final router = ref.read(routerProvider);
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AtlasButton(
            key: const Key('onboarding.finish'),
            label: failed ? 'Qayta urinish' : 'Boshlash',
            loading: saving,
            onPressed: c.finish,
          ),
          const SizedBox(height: AtlasSpacing.xs),
          AtlasButton(
            key: const Key('onboarding.finishToWardrobe'),
            label: 'Birinchi kiyimni qo‘shish',
            variant: AtlasButtonVariant.ghost,
            onPressed: saving
                ? null
                : () async {
                    await c.finish();
                    if (ref.read(onboardingGateProvider).status == OnboardingStatus.notRequired) {
                      router.go(AtlasRoutes.wardrobe);
                    }
                  },
          ),
        ],
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AtlasButton(
          key: const Key('onboarding.next'),
          label: step == OnboardingStep.welcome ? 'Boshladik' : 'Davom etish',
          onPressed: c.next,
        ),
        if (optional) ...[
          const SizedBox(height: AtlasSpacing.xs),
          AtlasButton(
            key: const Key('onboarding.skipStep'),
            label: 'Bu qadamni o‘tkazish',
            variant: AtlasButtonVariant.ghost,
            onPressed: c.skipStep,
          ),
        ],
      ],
    );
  }
}
