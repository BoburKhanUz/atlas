import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import 'tab_reselect.dart';

/// Top-level tab page: large left-aligned title that collapses into a compact
/// app bar on scroll, then [slivers] (or a single [body] filling the rest).
/// Tapping the active tab again scrolls it back to the top.
class AtlasPage extends StatefulWidget {
  const AtlasPage({super.key, required this.title, this.subtitle, this.actions = const [], this.slivers, this.body})
    : assert((slivers == null) != (body == null), 'Provide either slivers or body');

  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final List<Widget>? slivers;
  final Widget? body;

  @override
  State<AtlasPage> createState() => _AtlasPageState();
}

class _AtlasPageState extends State<AtlasPage> {
  final _scroll = ScrollController();
  ValueNotifier<int>? _taps;
  bool _tabActive = true;
  bool _animate = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final taps = TabReselect.maybeOf(context);
    if (!identical(taps, _taps)) {
      _taps?.removeListener(_onReselect);
      _taps = taps?..addListener(_onReselect);
    }
    _tabActive = TickerMode.valuesOf(context).enabled;
    _animate = AtlasMotion.enabled(context);
  }

  void _onReselect() {
    final isTop = ModalRoute.of(context)?.isCurrent ?? true;
    if (!_tabActive || !isTop || !_scroll.hasClients) return;
    if (_animate) {
      _scroll.animateTo(0, duration: AtlasMotion.slow, curve: AtlasMotion.curve);
    } else {
      _scroll.jumpTo(0);
    }
  }

  @override
  void dispose() {
    _taps?.removeListener(_onReselect);
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final AtlasPage(:title, :subtitle, :actions, :slivers, :body) = widget;
    return Scaffold(
      body: CustomScrollView(
        controller: _scroll,
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
                        Text(subtitle, style: text.bodyMedium),
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
