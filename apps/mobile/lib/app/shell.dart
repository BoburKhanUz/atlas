import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/widgets/network_banner.dart';

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

/// Bottom navigation around the tab branches. Each tab keeps its own stack;
/// tapping the active tab returns it to its root.
class AtlasShell extends StatelessWidget {
  const AtlasShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const NetworkBanner(),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: Theme.of(context).dividerTheme.color!)),
            ),
            child: NavigationBar(
              selectedIndex: navigationShell.currentIndex,
              onDestinationSelected: (index) =>
                  navigationShell.goBranch(index, initialLocation: index == navigationShell.currentIndex),
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
    );
  }
}
