import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';

enum AtlasButtonVariant { primary, secondary, ghost }

/// Full-width action button. While [loading] it shows a spinner, ignores taps
/// and keeps its size (no layout jump).
class AtlasButton extends StatelessWidget {
  const AtlasButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.variant = AtlasButtonVariant.primary,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final AtlasButtonVariant variant;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final onTap = loading ? null : onPressed;
    final spinnerColor = variant == AtlasButtonVariant.primary ? AtlasColors.onAccent : AtlasColors.accent;
    final child = AnimatedSwitcher(
      duration: AtlasMotion.of(context, AtlasMotion.fast),
      child: loading
          ? SizedBox.square(
              key: const ValueKey('loading'),
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2.2, color: spinnerColor),
            )
          : Row(
              key: const ValueKey('label'),
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: AtlasSpacing.xs)],
                Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
              ],
            ),
    );

    final button = switch (variant) {
      AtlasButtonVariant.primary => FilledButton(
        onPressed: onTap,
        style: loading
            ? FilledButton.styleFrom(
                disabledBackgroundColor: AtlasColors.accent,
                disabledForegroundColor: AtlasColors.onAccent,
              )
            : null,
        child: child,
      ),
      AtlasButtonVariant.secondary => OutlinedButton(onPressed: onTap, child: child),
      AtlasButtonVariant.ghost => TextButton(onPressed: onTap, child: child),
    };

    return Semantics(
      button: true,
      enabled: onTap != null,
      label: loading ? '$label, yuklanmoqda' : null,
      excludeSemantics: loading,
      child: expand ? SizedBox(width: double.infinity, child: button) : button,
    );
  }
}
