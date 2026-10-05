import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';

/// Surface card with a hairline border; tappable when [onTap] is set.
class AtlasCard extends StatelessWidget {
  const AtlasCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(AtlasSpacing.md)});

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// Small uppercase heading above a group of content.
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AtlasSpacing.sm),
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              header: true,
              child: Text(title.toUpperCase(), style: Theme.of(context).textTheme.labelSmall),
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}
