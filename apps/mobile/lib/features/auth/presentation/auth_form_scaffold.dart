import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';

/// Shared layout of the sign-in and registration screens.
class AuthFormScaffold extends StatelessWidget {
  const AuthFormScaffold({super.key, required this.title, required this.subtitle, required this.children});

  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen, vertical: AtlasSpacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('ATLAS', style: text.titleMedium?.copyWith(letterSpacing: 4, color: AtlasColors.accent)),
                  const SizedBox(height: AtlasSpacing.lg),
                  Text(title, style: text.headlineMedium),
                  const SizedBox(height: AtlasSpacing.xs),
                  Text(subtitle, style: text.bodyMedium),
                  const SizedBox(height: AtlasSpacing.xl),
                  ...children,
                ],
              ),
            ),
          ),
        ),
      ),
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
