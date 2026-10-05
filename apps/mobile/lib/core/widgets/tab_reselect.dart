import 'package:material_ui/material_ui.dart';

/// Tells tab pages that the active tab was tapped again. The shell bumps
/// the counter; the page of the active tab that is on top scrolls to the
/// top ([AtlasPage] does this).
class TabReselect extends InheritedNotifier<ValueNotifier<int>> {
  const TabReselect({super.key, required ValueNotifier<int> taps, required super.child}) : super(notifier: taps);

  static ValueNotifier<int>? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<TabReselect>()?.notifier;
}
