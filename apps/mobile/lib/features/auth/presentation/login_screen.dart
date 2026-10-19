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
      subtitle: 'Hisobingizga kiring — garderobingiz va obrazlaringiz sizni kutmoqda.',
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
                  decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline_rounded)),
                  validator: AuthValidators.email,
                ),
                const SizedBox(height: AtlasSpacing.md),
                PasswordFormField(
                  key: const Key('login.password'),
                  controller: _password,
                  enabled: !busy,
                  autofillHints: const [AutofillHints.password],
                  onFieldSubmitted: (_) => _submit(),
                  validator: AuthValidators.loginPassword,
                ),
              ],
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            key: const Key('login.forgot'),
            onPressed: busy ? null : () => context.push(AtlasRoutes.forgotPassword),
            child: const Text('Parolni unutdingizmi?'),
          ),
        ),
        const SizedBox(height: AtlasSpacing.xxs),
        AtlasButton(key: const Key('login.submit'), label: 'Kirish', loading: busy, onPressed: _submit),
        const SizedBox(height: AtlasSpacing.xs),
        AuthSwitchLink(
          actionKey: const Key('login.toRegister'),
          question: 'Hisobingiz yo‘qmi?',
          action: 'Ro‘yxatdan o‘ting',
          onPressed: busy ? null : () => context.go(AtlasRoutes.register),
        ),
      ],
    );
  }
}
