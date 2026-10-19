import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_brand.dart';

/// Shared layout of the sign-in and registration screens: a brand hero and
/// the form on a raised card that overlaps it.
class AuthFormScaffold extends StatelessWidget {
  const AuthFormScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.compactHero = false,
  });

  final String title;

  /// Only the logo in the hero: for longer forms (registration).
  final bool compactHero;
  final String subtitle;
  final List<Widget> children;

  // How far the form card reaches up into the hero.
  static const _overlap = 40.0;
  static const _cardRadius = BorderRadius.all(Radius.circular(28));

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final insets = MediaQuery.paddingOf(context);
    // Short screens: no hero subtitle.
    final short = MediaQuery.sizeOf(context).height < 720;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: SingleChildScrollView(
          padding: EdgeInsets.only(bottom: insets.bottom + AtlasSpacing.lg),
          child: Column(
            children: [
              DecoratedBox(
                decoration: const BoxDecoration(
                  gradient: AtlasColors.heroGradient,
                  borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
                ),
                child: ClipRRect(
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
                  child: Stack(
                    children: [
                      const Positioned.fill(child: HeroDecoration()),
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          AtlasSpacing.screen,
                          insets.top + AtlasSpacing.lg,
                          AtlasSpacing.screen,
                          _overlap + AtlasSpacing.lg,
                        ),
                        child: Center(
                          child: Container(
                            width: double.infinity,
                            constraints: const BoxConstraints(maxWidth: 440),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const AtlasLogo(onDark: true),
                                if (!compactHero) ...[
                                  SizedBox(height: short ? AtlasSpacing.lg : AtlasSpacing.xl),
                                  Text(
                                    'Har kuni nima kiyishni\nATLAS biladi.',
                                    style: text.displaySmall?.copyWith(color: AtlasColors.onAccent),
                                  ),
                                  if (!short) ...[
                                    const SizedBox(height: AtlasSpacing.xs),
                                    Text(
                                      'Garderobingiz, ob-havo va vaziyatga mos obrazlar — shaxsiy stilistingizdan.',
                                      style: text.bodyLarge?.copyWith(color: AtlasColors.onInkMuted),
                                    ),
                                  ],
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Transform.translate(
                offset: const Offset(0, -_overlap),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.md),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      // A Material, not a coloured box: the checkboxes' ink shows on it.
                      child: DecoratedBox(
                        decoration: const BoxDecoration(borderRadius: _cardRadius, boxShadow: AtlasShadows.card),
                        child: Material(
                          color: AtlasColors.surface,
                          borderRadius: _cardRadius,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(
                              AtlasSpacing.lg,
                              AtlasSpacing.lg,
                              AtlasSpacing.lg,
                              AtlasSpacing.md,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Semantics(header: true, child: Text(title, style: text.headlineMedium)),
                                const SizedBox(height: AtlasSpacing.xxs),
                                Text(subtitle, style: text.bodyMedium),
                                const SizedBox(height: AtlasSpacing.lg),
                                ...children,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A password field with a show/hide button.
class PasswordFormField extends StatefulWidget {
  const PasswordFormField({
    super.key,
    required this.controller,
    required this.validator,
    required this.autofillHints,
    this.enabled = true,
    this.labelText = 'Parol',
    this.helperText,
    this.onFieldSubmitted,
  });

  final TextEditingController controller;
  final FormFieldValidator<String> validator;
  final Iterable<String> autofillHints;
  final bool enabled;
  final String labelText;
  final String? helperText;
  final ValueChanged<String>? onFieldSubmitted;

  @override
  State<PasswordFormField> createState() => _PasswordFormFieldState();
}

class _PasswordFormFieldState extends State<PasswordFormField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      enabled: widget.enabled,
      obscureText: !_visible,
      autocorrect: false,
      enableSuggestions: false,
      autofillHints: widget.autofillHints,
      textInputAction: TextInputAction.done,
      onFieldSubmitted: widget.onFieldSubmitted,
      decoration: InputDecoration(
        labelText: widget.labelText,
        helperText: widget.helperText,
        prefixIcon: const Icon(Icons.lock_outline_rounded),
        suffixIcon: IconButton(
          key: const Key('password.visibility'),
          tooltip: _visible ? 'Parolni yashirish' : 'Parolni ko‘rsatish',
          icon: Icon(_visible ? Icons.visibility_off_outlined : Icons.visibility_outlined),
          onPressed: () => setState(() => _visible = !_visible),
        ),
      ),
      validator: widget.validator,
    );
  }
}

/// "Hisobingiz yo‘qmi? Ro‘yxatdan o‘ting": a line of text and a link.
class AuthSwitchLink extends StatelessWidget {
  const AuthSwitchLink({
    super.key,
    required this.question,
    required this.action,
    required this.onPressed,
    this.actionKey,
  });

  final String question;
  final Key? actionKey;
  final String action;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(question, style: Theme.of(context).textTheme.bodyMedium),
        TextButton(key: actionKey, onPressed: onPressed, child: Text(action)),
      ],
    );
  }
}

/// An inline message above the form (session ended, request failed).
class AuthNotice extends StatelessWidget {
  const AuthNotice({super.key, required this.message, this.error = true});

  final String message;
  final bool error;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: AtlasSpacing.md),
        padding: const EdgeInsets.all(AtlasSpacing.sm),
        decoration: BoxDecoration(
          color: error ? AtlasColors.errorSoft : AtlasColors.warningSoft,
          borderRadius: AtlasRadii.field,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              error ? Icons.error_outline_rounded : Icons.info_outline_rounded,
              size: 20,
              color: error ? AtlasColors.error : AtlasColors.warning,
            ),
            const SizedBox(width: AtlasSpacing.xs),
            Expanded(
              child: Text(message, style: TextStyle(color: error ? AtlasColors.error : AtlasColors.warning)),
            ),
          ],
        ),
      ),
    );
  }
}
