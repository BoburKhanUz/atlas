import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/auth_state.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../legal/data/legal_repository.dart' show LegalBundle;
import '../../legal/presentation/consent_checkbox_field.dart';
import '../../legal/providers.dart';
import 'auth_form_scaffold.dart';
import 'auth_messages.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _consent = GlobalKey<FormFieldState<bool>>();
  bool _ageConfirmed = false;
  bool _loadingLegal = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _error = null);
    TextInput.finishAutofillContext();
    final name = _name.text.trim();
    try {
      // The version of the documents behind the links is the one accepted.
      if (ref.read(legalDocumentsProvider).hasError) ref.invalidate(legalDocumentsProvider);
      setState(() => _loadingLegal = true);
      final LegalBundle legal;
      try {
        legal = await ref.read(legalDocumentsProvider.future);
      } finally {
        if (mounted) setState(() => _loadingLegal = false);
      }
      if (!mounted) return;
      await ref
          .read(sessionControllerProvider)
          .register(
            email: _email.text.trim(),
            password: _password.text,
            name: name.isEmpty ? null : name,
            acceptedLegalVersion: legal.version,
            ageConfirmed: _ageConfirmed,
          );
    } on StateError {
      // A sign-in is already running.
    } catch (error, stack) {
      final f = failureOf(error, stack);
      if (!mounted) return;
      if (f is ApiHttpFailure && f.fieldErrors.any((e) => e.path == 'acceptedLegalVersion')) {
        // The documents changed since they were loaded: load the new ones and ask again.
        ref.invalidate(legalDocumentsProvider);
        _consent.currentState?.didChange(false);
      }
      setState(() => _error = authFailureMessage(f));
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = ref.watch(authStateProvider) is Authenticating || _loadingLegal;
    // Loaded with the screen, so the links open at once and submit has the version.
    ref.watch(legalDocumentsProvider);
    return AuthFormScaffold(
      compactHero: true,
      title: 'Hisob yaratish',
      subtitle: 'Bir daqiqada tayyor: kiyimlaringizni qo‘shing va birinchi obrazni oling.',
      children: [
        if (_error != null) AuthNotice(message: _error!),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: const Key('register.name'),
                  controller: _name,
                  enabled: !busy,
                  autofillHints: const [AutofillHints.name],
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'Ism (ixtiyoriy)',
                    prefixIcon: Icon(Icons.person_outline_rounded),
                  ),
                  validator: AuthValidators.name,
                ),
                const SizedBox(height: AtlasSpacing.md),
                TextFormField(
                  key: const Key('register.email'),
                  controller: _email,
                  enabled: !busy,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline_rounded)),
                  validator: AuthValidators.email,
                ),
                const SizedBox(height: AtlasSpacing.md),
                PasswordFormField(
                  key: const Key('register.password'),
                  controller: _password,
                  enabled: !busy,
                  autofillHints: const [AutofillHints.newPassword],
                  onFieldSubmitted: (_) => _submit(),
                  helperText: 'Kamida 8 belgi',
                  validator: AuthValidators.newPassword,
                ),
                const SizedBox(height: AtlasSpacing.sm),
                ConsentCheckboxField(
                  key: const Key('register.age'),
                  label: '18 yoshdan kattaman',
                  requiredMessage: '18 yoshdan kattaligingizni tasdiqlang.',
                  enabled: !busy,
                  onChanged: (v) => _ageConfirmed = v,
                ),
                KeyedSubtree(
                  key: const Key('register.consent'),
                  child: ConsentCheckboxField(
                    key: _consent,
                    label: 'Foydalanish shartlari va Maxfiylik siyosatiga roziman',
                    title: LegalConsentLabel(
                      keyPrefix: 'register',
                      onOpen: (kind) => context.push(AtlasRoutes.legal(kind)),
                    ),
                    requiredMessage:
                        'Ro‘yxatdan o‘tish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering.',
                    enabled: !busy,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AtlasSpacing.lg),
        AtlasButton(key: const Key('register.submit'), label: 'Ro‘yxatdan o‘tish', loading: busy, onPressed: _submit),
        const SizedBox(height: AtlasSpacing.xs),
        AuthSwitchLink(
          actionKey: const Key('register.toLogin'),
          question: 'Hisobingiz bormi?',
          action: 'Kirish',
          onPressed: busy ? null : () => context.go(AtlasRoutes.login),
        ),
      ],
    );
  }
}
