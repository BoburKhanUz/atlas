import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/widgets/network_banner.dart';
import '../core/widgets/tab_reselect.dart';

/// One bottom-navigation tab.
class AtlasTab {
  const AtlasTab({required this.label, required this.icon, required this.selectedIcon});

  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// Order matches the router branches.
const atlasTabs = <AtlasTab>[
  AtlasTab(label: 'Bosh sahifa', icon: Icons.home_outlined, selectedIcon: Icons.home_rounded),
  AtlasTab(label: 'Garderob', icon: Icons.checkroom_outlined, selectedIcon: Icons.checkroom_rounded),
  AtlasTab(label: 'Obrazlar', icon: Icons.style_outlined, selectedIcon: Icons.style_rounded),
  AtlasTab(label: 'Stilist', icon: Icons.auto_awesome_outlined, selectedIcon: Icons.auto_awesome),
  AtlasTab(label: 'Profil', icon: Icons.person_outline_rounded, selectedIcon: Icons.person_rounded),
];

/// Bottom navigation around the tab branches. Each tab keeps its own stack.
/// * Tapping the active tab returns it to its root and scrolls to the top.
/// * Android back: inside a tab, pops that tab's stack; on another tab's
///   root, goes to Home; on Home, leaves the app.
class AtlasShell extends StatefulWidget {
  const AtlasShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  State<AtlasShell> createState() => _AtlasShellState();
}

class _AtlasShellState extends State<AtlasShell> {
  final _reselect = ValueNotifier<int>(0);

  @override
  void dispose() {
    _reselect.dispose();
    super.dispose();
  }

  void _select(int index) {
    final shell = widget.navigationShell;
    final again = index == shell.currentIndex;
    shell.goBranch(index, initialLocation: again);
    if (again) _reselect.value++;
  }

  @override
  Widget build(BuildContext context) {
    final shell = widget.navigationShell;
    final onHome = shell.currentIndex == 0;
    return PopScope(
      canPop: onHome,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !onHome) shell.goBranch(0);
      },
      child: Scaffold(
        body: TabReselect(taps: _reselect, child: shell),
        bottomNavigationBar: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const NetworkBanner(),
            DecoratedBox(
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: Theme.of(context).dividerTheme.color!)),
              ),
              child: NavigationBar(
                selectedIndex: shell.currentIndex,
                onDestinationSelected: _select,
                destinations: [
                  for (final tab in atlasTabs)
                    NavigationDestination(
                      icon: Icon(tab.icon),
                      selectedIcon: Icon(tab.selectedIcon),
                      label: tab.label,
                      tooltip: '',
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
