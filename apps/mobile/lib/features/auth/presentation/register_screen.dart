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
      await ref
          .read(sessionControllerProvider)
          .register(email: _email.text.trim(), password: _password.text, name: name.isEmpty ? null : name);
    } on ApiFailure catch (f) {
      if (mounted) setState(() => _error = authFailureMessage(f));
    } on StateError {
      // A sign-in is already running.
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = ref.watch(authStateProvider) is Authenticating;
    return AuthFormScaffold(
      title: 'Hisob yaratish',
      subtitle: 'Shaxsiy stilistingiz bir daqiqada tayyor.',
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
                  decoration: const InputDecoration(labelText: 'Ism (ixtiyoriy)'),
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
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: AuthValidators.email,
                ),
                const SizedBox(height: AtlasSpacing.md),
                TextFormField(
                  key: const Key('register.password'),
                  controller: _password,
                  enabled: !busy,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _submit(),
                  decoration: const InputDecoration(labelText: 'Parol', helperText: 'Kamida 8 belgi'),
                  validator: AuthValidators.newPassword,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AtlasSpacing.lg),
        AtlasButton(key: const Key('register.submit'), label: 'Ro‘yxatdan o‘tish', loading: busy, onPressed: _submit),
        const SizedBox(height: AtlasSpacing.sm),
        AtlasButton(
          key: const Key('register.toLogin'),
          label: 'Hisobim bor — kirish',
          variant: AtlasButtonVariant.ghost,
          onPressed: busy ? null : () => context.go(AtlasRoutes.login),
        ),
      ],
    );
  }
}
