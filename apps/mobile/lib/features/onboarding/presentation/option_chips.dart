import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';

/// A wrap of selectable chips (multi- or single-choice, decided by the
/// caller's [onToggle]).
class OptionChips<T> extends StatelessWidget {
  const OptionChips({
    super.key,
    required this.options,
    required this.label,
    required this.isSelected,
    required this.onToggle,
    this.swatch,
    this.enabled = true,
    this.keyPrefix,
    this.maxSelected,
  });

  final List<T> options;
  final String Function(T) label;
  final bool Function(T) isSelected;
  final void Function(T) onToggle;
  final Color Function(T)? swatch;
  final bool enabled;

  /// Test keys: `<keyPrefix>.<index>`.
  final String? keyPrefix;

  /// When this many options are selected, the unselected ones are disabled
  /// (selected ones stay tappable so they can be removed).
  final int? maxSelected;

  @override
  Widget build(BuildContext context) {
    final full = maxSelected != null && options.where(isSelected).length >= maxSelected!;
    return Wrap(
      spacing: AtlasSpacing.xs,
      runSpacing: AtlasSpacing.xs,
      children: [
        for (final (i, o) in options.indexed)
          FilterChip(
            key: keyPrefix == null ? null : Key('$keyPrefix.$i'),
            label: Text(label(o)),
            selected: isSelected(o),
            onSelected: enabled && (!full || isSelected(o)) ? (_) => onToggle(o) : null,
            avatar: swatch == null
                ? null
                : Container(
                    width: 18,
                    height: 18,
                    decoration: BoxDecoration(
                      color: swatch!(o),
                      shape: BoxShape.circle,
                      border: Border.all(color: AtlasColors.hairline),
                    ),
                  ),
            showCheckmark: swatch == null,
            materialTapTargetSize: MaterialTapTargetSize.padded,
          ),
      ],
    );
  }
}

/// A small section title inside a step.
class StepSection extends StatelessWidget {
  const StepSection({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AtlasSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: AtlasSpacing.sm),
          child,
        ],
      ),
    );
  }
}
