import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../data/photo_picker.dart';
import '../providers.dart';
import 'add_item_controller.dart';
import 'review_panel.dart';
import 'wardrobe_messages.dart';

/// Add a garment: camera or gallery → prepared on the device → preview →
/// upload (progress) → analysing → the detected item, or a clear failure
/// with Retry (same upload) or "choose another photo".
class AddItemScreen extends ConsumerWidget {
  const AddItemScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(addItemControllerProvider);
    final c = ref.read(addItemControllerProvider.notifier);
    return PopScope(
      canPop: !s.busy,
      child: Scaffold(
        appBar: AppBar(title: const Text('Kiyim qo‘shish')),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AtlasSpacing.screen),
            child: switch (s.phase) {
              AddPhase.choose => _Choose(onPick: c.pick),
              AddPhase.preparing => const _Progress(key: Key('add.preparing'), label: 'Rasm tayyorlanmoqda…'),
              AddPhase.preview || AddPhase.uploading || AddPhase.analysing || AddPhase.failed => _Upload(state: s),
              AddPhase.completed || AddPhase.needsCorrection => _Success(state: s),
              AddPhase.rejected => _Rejected(state: s, onAgain: c.reset),
            },
          ),
        ),
      ),
    );
  }
}

class _Choose extends StatelessWidget {
  const _Choose({required this.onPick});
  final Future<void> Function(PhotoSource) onPick;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Kiyimni suratga oling', style: text.headlineMedium),
          const SizedBox(height: AtlasSpacing.xs),
          Text(
            'Kiyimni yorug‘ joyda, tekis fonda bitta o‘zini suratga oling. ATLAS turini, rangini va materialini aniqlaydi.',
            style: text.bodyMedium,
          ),
          const SizedBox(height: AtlasSpacing.xl),
          AtlasButton(
            key: const Key('add.camera'),
            label: 'Kamera',
            icon: Icons.photo_camera_outlined,
            onPressed: () => onPick(PhotoSource.camera),
          ),
          const SizedBox(height: AtlasSpacing.sm),
          AtlasButton(
            key: const Key('add.gallery'),
            label: 'Galereyadan tanlash',
            icon: Icons.photo_library_outlined,
            variant: AtlasButtonVariant.secondary,
            onPressed: () => onPick(PhotoSource.gallery),
          ),
          const SizedBox(height: AtlasSpacing.lg),
          Text(
            'Joylashuv va boshqa yashirin ma’lumotlar rasmdan olib tashlanadi.',
            style: text.bodySmall?.copyWith(color: AtlasColors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress({super.key, required this.label, this.value});
  final String label;
  final double? value;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LinearProgressIndicator(value: value, minHeight: 6, borderRadius: BorderRadius.circular(AtlasRadii.pill)),
          const SizedBox(height: AtlasSpacing.sm),
          Text(label, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _Upload extends ConsumerWidget {
  const _Upload({required this.state});
  final AddItemState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.read(addItemControllerProvider.notifier);
    final job = state.job!;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: AtlasRadii.card,
            child: Image.memory(
              job.image.bytes,
              key: const Key('add.preview'),
              fit: BoxFit.contain,
              gaplessPlayback: true,
              semanticLabel: 'Tanlangan rasm',
            ),
          ),
        ),
        const SizedBox(height: AtlasSpacing.md),
        switch (state.phase) {
          AddPhase.uploading => _Progress(
            key: const Key('add.uploading'),
            label: 'Yuklanmoqda… ${(state.progress * 100).round()}%',
            value: state.progress,
          ),
          AddPhase.analysing => const _Progress(key: Key('add.analysing'), label: 'Tahlil qilinmoqda…'),
          AddPhase.failed => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                state.failure?.userMessage ?? 'Yuklab bo‘lmadi.',
                key: const Key('add.failure'),
                style: text.bodyMedium?.copyWith(color: AtlasColors.error),
              ),
              const SizedBox(height: AtlasSpacing.sm),
              AtlasButton(key: const Key('add.retry'), label: 'Qayta urinish', onPressed: c.upload),
              TextButton(key: const Key('add.another'), onPressed: c.reset, child: const Text('Boshqa rasm tanlash')),
            ],
          ),
          _ => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (state.recovered)
                Padding(
                  padding: const EdgeInsets.only(bottom: AtlasSpacing.xs),
                  child: Text(
                    'Bu rasm avval yuklanayotgan edi — takror qo‘shilmasligi ta’minlanadi.',
                    key: const Key('add.recoveredNote'),
                    style: text.bodySmall,
                  ),
                ),
              AtlasButton(key: const Key('add.upload'), label: 'Yuklash', onPressed: c.upload),
              TextButton(key: const Key('add.another'), onPressed: c.reset, child: const Text('Boshqa rasm tanlash')),
            ],
          ),
        },
      ],
    );
  }
}

class _Success extends ConsumerWidget {
  const _Success({required this.state});
  final AddItemState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final item = state.item!;
    final c = ref.read(addItemControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final review = state.phase == AddPhase.needsCorrection;
    void edit() => context.push(AtlasRoutes.wardrobeItemEdit(item.id));
    return SingleChildScrollView(
      key: Key(review ? 'add.needsCorrection' : 'add.completed'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(
            review ? Icons.rule_rounded : Icons.check_circle_outline_rounded,
            size: 48,
            color: review ? AtlasColors.warning : AtlasColors.success,
          ),
          const SizedBox(height: AtlasSpacing.sm),
          Text(
            review ? 'Qo‘shildi — tekshirib chiqing' : 'Garderobga qo‘shildi',
            style: text.headlineSmall,
            textAlign: TextAlign.center,
          ),
          if (state.result!.replayed)
            Padding(
              padding: const EdgeInsets.only(top: AtlasSpacing.xs),
              child: Text(
                'Bu rasm avvalroq yuklangan ekan — takror qo‘shilmadi.',
                key: const Key('add.replayed'),
                style: text.bodyMedium,
                textAlign: TextAlign.center,
              ),
            ),
          const SizedBox(height: AtlasSpacing.lg),
          AttributeReviewList(item: item, acknowledged: state.acknowledged, onAcknowledge: c.acknowledge, onEdit: edit),
          const SizedBox(height: AtlasSpacing.md),
          AtlasButton(
            key: const Key('add.open'),
            label: 'Kiyimni ko‘rish',
            onPressed: () => context.pushReplacement(AtlasRoutes.wardrobeItem(item.id)),
          ),
          TextButton(key: const Key('add.edit'), onPressed: edit, child: const Text('Xususiyatlarni tuzatish')),
          TextButton(key: const Key('add.more'), onPressed: c.reset, child: const Text('Yana qo‘shish')),
        ],
      ),
    );
  }
}

class _Rejected extends StatelessWidget {
  const _Rejected({required this.state, required this.onAgain});
  final AddItemState state;
  final VoidCallback onAgain;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.image_not_supported_outlined, size: 48, color: AtlasColors.error),
          const SizedBox(height: AtlasSpacing.sm),
          Text(
            WardrobeMessages.reject(state.reject!, source: state.deniedSource),
            key: const Key('add.rejected'),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AtlasSpacing.lg),
          AtlasButton(key: const Key('add.pickAgain'), label: 'Boshqa rasm tanlash', onPressed: onAgain),
        ],
      ),
    );
  }
}
