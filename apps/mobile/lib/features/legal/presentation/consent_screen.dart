import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../auth/presentation/auth_form_scaffold.dart';
import '../providers.dart';
import 'consent_checkbox_field.dart';

/// The privacy policy or the terms of use changed since the user accepted
/// them. Nothing else of the app works until they are accepted again
/// (POST /api/v1/legal/consent); the user may also sign out, or decline by
/// deleting the account.
class ConsentScreen extends ConsumerStatefulWidget {
  const ConsentScreen({super.key});

  @override
  ConsumerState<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends ConsumerState<ConsentScreen> {
  final _form = GlobalKey<FormState>();
  final _consent = GlobalKey<FormFieldState<bool>>();
  bool _busy = false;
  String? _error;

  Future<void> _accept() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // The version of the texts behind the links is the one accepted.
      if (ref.read(legalDocumentsProvider).hasError) ref.invalidate(legalDocumentsProvider);
      final legal = await ref.read(legalDocumentsProvider.future);
      await ref.read(legalRepositoryProvider).accept(version: legal.version);
      if (!mounted) return;
      ref.read(consentGateProvider).markAccepted();
    } on ApiFailure catch (f) {
      if (!mounted) return;
      final outdated = f is ApiHttpFailure && f.fieldErrors.any((e) => e.path == 'acceptedLegalVersion');
      if (outdated) {
        // Changed again since they were loaded: load the new texts and ask again.
        ref.invalidate(legalDocumentsProvider);
        _consent.currentState?.didChange(false);
      }
      setState(
        () => _error = f is ApiHttpFailure && f.fieldErrors.isNotEmpty ? f.fieldErrors.first.message : f.userMessage,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Loaded with the screen, so the links open at once and accepting has the version.
    ref.watch(legalDocumentsProvider);
    return AuthFormScaffold(
      compactHero: true,
      title: 'Hujjatlar yangilandi',
      subtitle:
          'Maxfiylik siyosati va Foydalanish shartlari o‘zgardi. '
          'Ilovadan foydalanishni davom ettirish uchun ularni o‘qib chiqing va qabul qiling.',
      children: [
        if (_error != null) AuthNotice(key: const Key('consent.error'), message: _error!),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ConsentCheckboxField(
                key: const Key('consent.age'),
                label: '18 yoshdan kattaman',
                requiredMessage: '18 yoshdan kattaligingizni tasdiqlang.',
                enabled: !_busy,
              ),
              KeyedSubtree(
                key: const Key('consent.accepted'),
                child: ConsentCheckboxField(
                  key: _consent,
                  label: 'Foydalanish shartlari va Maxfiylik siyosatiga roziman',
                  title: LegalConsentLabel(
                    keyPrefix: 'consent',
                    onOpen: (kind) => context.push(AtlasRoutes.legal(kind)),
                  ),
                  requiredMessage: 'Davom etish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering.',
                  enabled: !_busy,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AtlasSpacing.lg),
        AtlasButton(key: const Key('consent.accept'), label: 'Qabul qilaman', loading: _busy, onPressed: _accept),
        const SizedBox(height: AtlasSpacing.sm),
        AtlasButton(
          key: const Key('consent.signOut'),
          label: 'Chiqish',
          variant: AtlasButtonVariant.ghost,
          onPressed: _busy ? null : () => ref.read(sessionControllerProvider).logout(),
        ),
        TextButton(
          key: const Key('consent.delete'),
          onPressed: _busy ? null : () => context.push(AtlasRoutes.profileDelete),
          style: TextButton.styleFrom(foregroundColor: AtlasColors.error),
          child: const Text('Rozi emasman — hisobni o‘chirish'),
        ),
      ],
    );
  }
}
