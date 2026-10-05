import 'package:material_ui/material_ui.dart';

import 'state_views.dart';

/// Temporary content for a tab whose feature lands in a later Phase 3 step.
/// Removed screen by screen as features are implemented — never shows
/// invented data.
class ComingSoonView extends StatelessWidget {
  const ComingSoonView({super.key, required this.icon, required this.title, required this.message});

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) => EmptyStateView(icon: icon, title: title, message: message);
}
