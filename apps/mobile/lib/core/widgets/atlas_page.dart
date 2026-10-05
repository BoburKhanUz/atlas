import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';

/// Top-level tab page: large left-aligned title that collapses into a compact
/// app bar on scroll, then [slivers] (or a single [body] filling the rest).
class AtlasPage extends StatelessWidget {
  const AtlasPage({super.key, required this.title, this.subtitle, this.actions = const [], this.slivers, this.body})
    : assert((slivers == null) != (body == null), 'Provide either slivers or body');

  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final List<Widget>? slivers;
  final Widget? body;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar.large(
            title: Text(title),
            actions: [
              ...actions,
              const SizedBox(width: AtlasSpacing.xs),
            ],
            expandedHeight: subtitle == null ? 120 : 140,
            flexibleSpace: subtitle == null
                ? null
                : FlexibleSpaceBar(
                    titlePadding: const EdgeInsetsDirectional.only(start: AtlasSpacing.screen, bottom: AtlasSpacing.sm),
                    expandedTitleScale: 1,
                    title: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: text.headlineMedium),
                        Text(subtitle!, style: text.bodyMedium),
                      ],
                    ),
                  ),
          ),
          ...?slivers,
          // The body fills the rest of the viewport and handles its own
          // scrolling (state views are scrollable for pull-to-refresh).
          if (body != null) SliverFillRemaining(child: body),
        ],
      ),
    );
  }
}
