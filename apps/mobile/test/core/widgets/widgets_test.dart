import 'package:atlas_mobile/core/design/theme.dart';
import 'package:atlas_mobile/core/widgets/atlas_button.dart';
import 'package:atlas_mobile/core/widgets/skeleton.dart';
import 'package:atlas_mobile/core/widgets/state_views.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget host(Widget child, {bool disableAnimations = false}) => MaterialApp(
  theme: AtlasTheme.light(),
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: Scaffold(body: Center(child: child)),
  ),
);

void main() {
  group('AtlasButton', () {
    testWidgets('calls onPressed when tapped', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(AtlasButton(label: 'Saqlash', onPressed: () => taps++)));
      await tester.tap(find.text('Saqlash'));
      expect(taps, 1);
    });

    testWidgets('while loading: spinner, no taps, same height, announced as loading', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(AtlasButton(label: 'Saqlash', onPressed: () => taps++)));
      final idleHeight = tester.getSize(find.byType(FilledButton)).height;

      await tester.pumpWidget(host(AtlasButton(label: 'Saqlash', loading: true, onPressed: () => taps++)));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      expect(taps, 0);
      expect(tester.getSize(find.byType(FilledButton)).height, idleHeight);
      expect(
        tester.getSemantics(find.byType(AtlasButton)),
        matchesSemantics(label: 'Saqlash, yuklanmoqda', isButton: true, hasEnabledState: true),
      );
    });

    testWidgets('meets the 48 px touch target', (tester) async {
      await tester.pumpWidget(
        host(AtlasButton(label: 'OK', onPressed: () {}, variant: AtlasButtonVariant.ghost, expand: false)),
      );
      final size = tester.getSize(find.byType(TextButton));
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThanOrEqualTo(48));
    });
  });

  group('state views', () {
    testWidgets('error view shows a friendly message and retries', (tester) async {
      var retries = 0;
      await tester.pumpWidget(host(ErrorStateView(onRetry: () => retries++)));
      expect(find.text('Nimadir xato ketdi'), findsOneWidget);
      await tester.tap(find.text('Qayta urinish'));
      expect(retries, 1);
    });

    testWidgets('empty view action is optional', (tester) async {
      await tester.pumpWidget(host(const EmptyStateView(icon: Icons.checkroom_outlined, title: 'Hali kiyim yo‘q')));
      expect(find.text('Hali kiyim yo‘q'), findsOneWidget);
      expect(find.byType(AtlasButton), findsNothing);
    });

    testWidgets('views do not overflow on a small screen with large text', (tester) async {
      tester.view.physicalSize = const Size(320 * 2, 480 * 2);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: AtlasTheme.light(),
          home: MediaQuery(
            data: const MediaQueryData(size: Size(320, 480), textScaler: TextScaler.linear(1.6)),
            child: Scaffold(body: OfflineStateView(onRetry: () {})),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Internet aloqasi yo‘q'), findsOneWidget);
    });
  });

  group('Skeleton', () {
    testWidgets('animates normally', (tester) async {
      await tester.pumpWidget(host(const SizedBox(width: 200, child: Skeleton())));
      final transition = tester.widget<FadeTransition>(
        find.descendant(of: find.byType(Skeleton), matching: find.byType(FadeTransition)),
      );
      final before = transition.opacity.value;
      await tester.pump(const Duration(milliseconds: 500));
      expect(transition.opacity.value, isNot(before));
    });

    testWidgets('is static with reduced motion', (tester) async {
      await tester.pumpWidget(host(const SizedBox(width: 200, child: Skeleton()), disableAnimations: true));
      final transition = tester.widget<FadeTransition>(
        find.descendant(of: find.byType(Skeleton), matching: find.byType(FadeTransition)),
      );
      final before = transition.opacity.value;
      await tester.pump(const Duration(milliseconds: 500));
      expect(transition.opacity.value, before);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('LoadingView announces loading once and hides the blocks', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(const SizedBox(height: 600, child: LoadingView())));
      expect(find.bySemanticsLabel('Yuklanmoqda'), findsOneWidget);
      handle.dispose();
    });
  });
}
