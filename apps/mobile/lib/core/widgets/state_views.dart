import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import 'atlas_button.dart';

/// Centered illustration-style message used by empty, error and offline
/// states. Scrollable so it never overflows on small screens or with large
/// text, and so pull-to-refresh works on it.
class _MessageView extends StatelessWidget {
  const _MessageView({
    required this.icon,
    required this.iconColor,
    required this.iconBackground,
    required this.title,
    this.message,
    this.action,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBackground;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.xl, vertical: AtlasSpacing.xxl),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(color: iconBackground, shape: BoxShape.circle),
                  child: Icon(icon, size: 32, color: iconColor),
                ),
                const SizedBox(height: AtlasSpacing.lg),
                Text(title, style: text.titleLarge, textAlign: TextAlign.center),
                if (message != null) ...[
                  const SizedBox(height: AtlasSpacing.xs),
                  Text(message!, style: text.bodyMedium, textAlign: TextAlign.center),
                ],
                if (action != null) ...[
                  const SizedBox(height: AtlasSpacing.lg),
                  ConstrainedBox(constraints: const BoxConstraints(maxWidth: 320), child: action),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class EmptyStateView extends StatelessWidget {
  const EmptyStateView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => _MessageView(
    icon: icon,
    iconColor: AtlasColors.accent,
    iconBackground: AtlasColors.accentSoft,
    title: title,
    message: message,
    action: actionLabel != null && onAction != null ? AtlasButton(label: actionLabel!, onPressed: onAction) : null,
  );
}

/// User-facing error. [message] must already be a friendly text — never a
/// raw exception or backend error string.
class ErrorStateView extends StatelessWidget {
  const ErrorStateView({
    super.key,
    this.title = 'Nimadir xato ketdi',
    this.message = 'Qayta urinib ko‘ring. Muammo takrorlansa, birozdan so‘ng yana kiring.',
    this.onRetry,
    this.retrying = false,
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;
  final bool retrying;

  @override
  Widget build(BuildContext context) => _MessageView(
    icon: Icons.error_outline_rounded,
    iconColor: AtlasColors.error,
    iconBackground: AtlasColors.errorSoft,
    title: title,
    message: message,
    action: onRetry == null
        ? null
        : AtlasButton(
            label: 'Qayta urinish',
            icon: Icons.refresh_rounded,
            variant: AtlasButtonVariant.secondary,
            loading: retrying,
            onPressed: onRetry,
          ),
  );
}

class OfflineStateView extends StatelessWidget {
  const OfflineStateView({super.key, this.onRetry});

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => _MessageView(
    icon: Icons.cloud_off_rounded,
    iconColor: AtlasColors.warning,
    iconBackground: AtlasColors.warningSoft,
    title: 'Internet aloqasi yo‘q',
    message: 'Ulanish tiklanganda ma’lumotlar yangilanadi.',
    action: onRetry == null
        ? null
        : AtlasButton(label: 'Qayta urinish', variant: AtlasButtonVariant.secondary, onPressed: onRetry),
  );
}
