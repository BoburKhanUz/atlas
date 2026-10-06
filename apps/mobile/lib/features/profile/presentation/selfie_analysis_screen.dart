import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../wardrobe/data/image_preparer.dart' show PreparationError;
import '../../wardrobe/data/photo_picker.dart';
import '../data/color_profile_repository.dart';
import '../providers.dart';
import 'color_profile_screen.dart' show ColorProfileView;
import 'selfie_analysis_controller.dart';

/// Consent → camera (front) or gallery → analysis. No permission is asked
/// before the user has read the consent and chosen a source.
class SelfieAnalysisScreen extends ConsumerWidget {
  const SelfieAnalysisScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(selfieAnalysisControllerProvider);
    final c = ref.read(selfieAnalysisControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final busy = s.phase == SelfiePhase.picking || s.phase == SelfiePhase.preparing || s.phase == SelfiePhase.analysing;

    final Widget body = switch (s.phase) {
      SelfiePhase.consent || SelfiePhase.picking => ListView(
        key: const Key('selfie.consent'),
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        children: [
          Text('Rang profilini selfi orqali aniqlash', style: text.titleLarge),
          const SizedBox(height: AtlasSpacing.md),
          for (final line in const [
            'Rasm faqat bir marta tahlil qilinadi va serverda saqlanmaydi; tashqi AI xizmatiga yuborilmaydi.',
            'Faqat natija saqlanadi: mavsum, ton, kontrast, teri/soch/ko‘z rangi va mos ranglar.',
            'Natijani istalgan vaqtda «Rang profili» sahifasida o‘chirishingiz mumkin.',
            'Rasm yuborishdan oldin undagi joylashuv va boshqa ma’lumotlar (EXIF/GPS) olib tashlanadi.',
            'Bu taxminiy styling tavsiyasi, tibbiy xulosa emas. Yorug‘lik va kamera natijaga ta’sir qiladi.',
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: AtlasSpacing.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(Icons.check_circle_outline, size: 18, color: AtlasColors.accent),
                  ),
                  const SizedBox(width: AtlasSpacing.xs),
                  Expanded(child: Text(line, style: text.bodyMedium)),
                ],
              ),
            ),
          const SizedBox(height: AtlasSpacing.sm),
          Text('Maslahat: kunduzgi yorug‘likda, yuzingiz to‘liq ko‘rinadigan selfi oling.', style: text.bodySmall),
          if (s.denied != null) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Text(
              s.denied == PhotoSource.camera
                  ? 'Kameraga ruxsat berilmagan. Sozlamalardan ruxsat bering yoki galereyadan tanlang.'
                  : 'Rasmlarga ruxsat berilmagan. Sozlamalardan ruxsat bering yoki kameradan foydalaning.',
              key: const Key('selfie.denied'),
              style: const TextStyle(color: AtlasColors.error),
            ),
          ],
          const SizedBox(height: AtlasSpacing.lg),
          AtlasButton(
            key: const Key('selfie.camera'),
            label: 'Roziman — selfi olish',
            icon: Icons.camera_front_outlined,
            loading: s.phase == SelfiePhase.picking,
            onPressed: () => c.pick(PhotoSource.camera),
          ),
          const SizedBox(height: AtlasSpacing.xs),
          AtlasButton(
            key: const Key('selfie.gallery'),
            label: 'Roziman — galereyadan',
            icon: Icons.photo_library_outlined,
            variant: AtlasButtonVariant.secondary,
            onPressed: s.phase == SelfiePhase.picking ? null : () => c.pick(PhotoSource.gallery),
          ),
        ],
      ),
      SelfiePhase.preparing || SelfiePhase.analysing => Center(
        key: const Key('selfie.progress'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: AtlasSpacing.md),
            Text(s.phase == SelfiePhase.preparing ? 'Rasm tayyorlanmoqda…' : 'Ranglar tahlil qilinmoqda…'),
          ],
        ),
      ),
      SelfiePhase.done => ListView(
        key: const Key('selfie.done'),
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        children: [
          ColorProfileView(analysed: s.result!),
          const SizedBox(height: AtlasSpacing.md),
          AtlasButton(key: const Key('selfie.finish'), label: 'Tayyor', onPressed: () => context.pop()),
        ],
      ),
      SelfiePhase.rejected => _Message(
        key: const Key('selfie.rejected'),
        text: switch (s.rejection) {
          PreparationError.tooSmall => 'Rasm juda kichik. Kattaroq rasm tanlang.',
          PreparationError.tooLarge => 'Rasm juda katta. Boshqa rasm tanlang.',
          _ => serverRejection(s.failure),
        },
        actions: [AtlasButton(key: const Key('selfie.again'), label: 'Boshqa rasm', onPressed: c.restart)],
      ),
      SelfiePhase.failed => _Message(
        key: const Key('selfie.failed'),
        text: s.failure?.userMessage ?? 'Tahlil qilinmadi.',
        actions: [
          AtlasButton(key: const Key('selfie.retry'), label: 'Qayta urinish', onPressed: c.analyse),
          TextButton(onPressed: c.restart, child: const Text('Boshqa rasm')),
        ],
      ),
      SelfiePhase.unknown => ListView(
        key: const Key('selfie.unknown'),
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        children: [
          Container(
            padding: const EdgeInsets.all(AtlasSpacing.sm),
            decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
            child: const Text(
              'Javob kelmadi: bu tahlil bajarilganmi — noma’lum. Quyida serverdagi joriy natija ko‘rsatilgan '
              '(sanasiga qarang).',
              style: TextStyle(color: AtlasColors.warning),
            ),
          ),
          const SizedBox(height: AtlasSpacing.md),
          switch (s.serverCurrent) {
            final Analysed a => ColorProfileView(analysed: a),
            NotAnalysed() => const Text('Serverda hali rang profili yo‘q.', key: Key('selfie.unknown.none')),
            null => const Text('Serverdagi natijani tekshirib bo‘lmadi.', key: Key('selfie.unknown.unread')),
          },
          const SizedBox(height: AtlasSpacing.md),
          if (s.hasImage)
            AtlasButton(
              key: const Key('selfie.analyseAgain'),
              label: 'Qayta tahlil qilish',
              variant: AtlasButtonVariant.secondary,
              onPressed: c.analyse,
            ),
          TextButton(onPressed: () => context.pop(), child: const Text('Yopish')),
        ],
      ),
    };
    return PopScope(
      canPop: !busy,
      child: Scaffold(
        appBar: AppBar(title: const Text('Selfi tahlili')),
        body: SafeArea(child: body),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({super.key, required this.text, required this.actions});
  final String text;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(AtlasSpacing.screen),
    children: [
      Text(text, style: Theme.of(context).textTheme.bodyLarge),
      const SizedBox(height: AtlasSpacing.lg),
      ...actions,
    ],
  );
}

/// The server's reason for refusing the photo, as advice for the next one.
@visibleForTesting
String serverRejection(ApiFailure? f) {
  if (f is! ApiHttpFailure) return 'Bu rasmni tahlil qilib bo‘lmadi. Boshqa rasm tanlang.';
  return switch (f.code) {
    ApiErrorCode.photoQualityTooLow => switch (f.fieldErrors.where((e) => e.path == 'reason').firstOrNull?.message) {
      'too_dark' => 'Rasm juda qorong‘i. Yorug‘roq joyda, yuzingizga yorug‘lik tushadigan selfi oling.',
      'overexposed' => 'Rasm juda yorug‘. To‘g‘ridan-to‘g‘ri quyosh yoki chiroqqa qaramasdan qayta oling.',
      'blurry' => 'Rasm xira chiqdi. Telefonni qimirlatmasdan, aniq selfi oling.',
      'background' => 'Yuz va fonni ajratib bo‘lmadi. Oddiy, teriga o‘xshamagan fon oldida suratga oling.',
      _ => 'Rasm sifati tahlil uchun yetarli emas. Kunduzgi yorug‘likda, aniq selfi oling.',
    },
    ApiErrorCode.skinNotVisible => 'Rasmda yuz terisi yetarlicha ko‘rinmadi. Yuzingiz to‘liq ko‘rinadigan selfi oling.',
    ApiErrorCode.imageDimensions => 'Rasm juda kichik. Kattaroq rasm tanlang.',
    _ => 'Bu rasmni tahlil qilib bo‘lmadi. Boshqa rasm tanlang.',
  };
}
