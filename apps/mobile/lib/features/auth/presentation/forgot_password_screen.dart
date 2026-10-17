import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_button.dart';
import '../providers.dart';
import 'auth_form_scaffold.dart';
import 'auth_messages.dart';

/// Requests a password reset link by e-mail. The answer never says whether
/// the account exists; the link opens the web page that sets the new password.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(passwordResetRepositoryProvider).requestLink(_email.text.trim());
      if (mounted) setState(() => _sent = true);
    } on ApiFailure catch (f) {
      if (mounted) setState(() => _error = authFailureMessage(f));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _back() => context.canPop() ? context.pop() : context.go(AtlasRoutes.login);

  @override
  Widget build(BuildContext context) {
    return AuthFormScaffold(
      title: 'Parolni tiklash',
      subtitle: _sent
          ? 'Pochtangizni tekshiring.'
          : 'Email manzilingizni kiriting: unga yangi parol o‘rnatish havolasini yuboramiz.',
      children: [
        if (_sent) ...[
          const AuthNotice(
            key: Key('forgot.sent'),
            error: false,
            message:
                'Agar bu email ro‘yxatdan o‘tgan bo‘lsa, unga havola yuborildi. Havolani oching va 60 daqiqa ichida '
                'yangi parol o‘rnating, so‘ng shu ilovada yangi parol bilan kiring. Xat kelmasa, «Spam» papkasini tekshiring.',
          ),
        ] else ...[
          if (_error != null) AuthNotice(message: _error!),
          Form(
            key: _form,
            child: TextFormField(
              key: const Key('forgot.email'),
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => _submit(),
              decoration: const InputDecoration(labelText: 'Email'),
              validator: AuthValidators.email,
            ),
          ),
          const SizedBox(height: AtlasSpacing.lg),
          AtlasButton(key: const Key('forgot.submit'), label: 'Havola yuborish', loading: _busy, onPressed: _submit),
        ],
        const SizedBox(height: AtlasSpacing.sm),
        AtlasButton(
          key: const Key('forgot.toLogin'),
          label: 'Kirishga qaytish',
          variant: AtlasButtonVariant.ghost,
          onPressed: _busy ? null : _back,
        ),
      ],
    );
  }
}
