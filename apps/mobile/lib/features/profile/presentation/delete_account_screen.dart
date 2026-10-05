import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../providers.dart';
import 'delete_account_controller.dart';

/// Account deletion: explanation, typed confirmation, one DELETE.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(deleteAccountControllerProvider);
    final c = ref.read(deleteAccountControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final deleting = s.phase == DeletePhase.deleting;
    return PopScope(
      canPop: !deleting,
      child: Scaffold(
        appBar: AppBar(title: const Text('Hisobni o‘chirish')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(AtlasSpacing.screen),
            children: [
              Text('Bu amalni qaytarib bo‘lmaydi', style: text.titleLarge?.copyWith(color: AtlasColors.error)),
              const SizedBox(height: AtlasSpacing.sm),
              const Text(
                'Hisobingiz darhol va butunlay o‘chiriladi: profil, afzalliklar, garderob va uning rasmlari, '
                'obrazlar, stilist suhbatlari va rang profili. Barcha qurilmalardagi sessiyalar yakunlanadi.',
                key: Key('delete.explanation'),
              ),
              const SizedBox(height: AtlasSpacing.lg),
              if (s.phase == DeletePhase.unknown) ...[
                Container(
                  key: const Key('delete.unknown'),
                  padding: const EdgeInsets.all(AtlasSpacing.sm),
                  decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
                  child: const Text(
                    'Javob kelmadi: hisob o‘chirildimi — noma’lum. “Tekshirish” so‘rovni yana yuboradi; '
                    'hisob allaqachon o‘chgan bo‘lsa, buni tasdiqlaydi.',
                    style: TextStyle(color: AtlasColors.warning),
                  ),
                ),
                const SizedBox(height: AtlasSpacing.md),
                AtlasButton(key: const Key('delete.check'), label: 'Tekshirish', onPressed: c.delete),
              ] else ...[
                Text('Tasdiqlash uchun “$deleteConfirmationWord” deb yozing:', style: text.bodyMedium),
                const SizedBox(height: AtlasSpacing.xs),
                TextField(
                  key: const Key('delete.typed'),
                  controller: _typed,
                  enabled: !deleting,
                  autocorrect: false,
                  textCapitalization: TextCapitalization.characters,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(hintText: deleteConfirmationWord),
                ),
                if (s.phase == DeletePhase.failed) ...[
                  const SizedBox(height: AtlasSpacing.xs),
                  Text(
                    s.failure?.userMessage ?? 'Hisob o‘chirilmadi.',
                    key: const Key('delete.failed'),
                    style: const TextStyle(color: AtlasColors.error),
                  ),
                ],
                const SizedBox(height: AtlasSpacing.lg),
                FilledButton(
                  key: const Key('delete.confirm'),
                  style: FilledButton.styleFrom(backgroundColor: AtlasColors.error),
                  onPressed: deleting || !DeleteAccountController.confirmationMatches(_typed.text)
                      ? null
                      : () => c.delete(typed: _typed.text),
                  child: deleting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AtlasColors.onAccent),
                        )
                      : const Text('Hisobni butunlay o‘chirish'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
