import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/network/user_messages.dart';
import '../../../core/session/auth_state.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../profile/providers.dart' show accountMaybeDeletedProvider;
import 'auth_form_scaffold.dart';
import 'auth_messages.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _error = null);
    TextInput.finishAutofillContext();
    try {
      await ref.read(sessionControllerProvider).login(email: _email.text.trim(), password: _password.text);
      // The router leaves this screen when the state becomes Authenticated.
    } on ApiFailure catch (f) {
      if (mounted) setState(() => _error = authFailureMessage(f));
    } on StateError {
      // A sign-in is already running.
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authStateProvider);
    final busy = state is Authenticating;
    final reason = switch (state) {
      SessionExpired(:final reason) || Unauthenticated(:final reason) => reason,
      _ => SignedOutReason.none,
    };
    // After an account deletion that could not be confirmed, the session
    // ended: say honestly that the account may be gone.
    final notice = ref.watch(accountMaybeDeletedProvider)
        ? 'Hisobingiz o‘chirilgan bo‘lishi mumkin. Kira olmasangiz, u o‘chirilgan.'
        : UserMessages.forSignedOut(reason);
    return AuthFormScaffold(
      title: 'Xush kelibsiz',
      subtitle: 'Garderobingiz va uslubingiz bilan davom eting.',
      children: [
        if (_error != null)
          AuthNotice(message: _error!)
        else if (notice != null)
          AuthNotice(message: notice, error: false),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: const Key('login.email'),
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
                  key: const Key('login.password'),
                  controller: _password,
                  enabled: !busy,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _submit(),
                  decoration: const InputDecoration(labelText: 'Parol'),
                  validator: AuthValidators.loginPassword,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AtlasSpacing.lg),
        AtlasButton(key: const Key('login.submit'), label: 'Kirish', loading: busy, onPressed: _submit),
        const SizedBox(height: AtlasSpacing.sm),
        AtlasButton(
          key: const Key('login.toRegister'),
          label: 'Hisob yaratish',
          variant: AtlasButtonVariant.ghost,
          onPressed: busy ? null : () => context.go(AtlasRoutes.register),
        ),
      ],
    );
  }
}
