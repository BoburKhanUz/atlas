import 'dart:async';

import 'package:atlas_mobile/app/app.dart';
import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart' show Scrollable;

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import 'wardrobe_fixtures.dart';

/// The whole app on a fake backend, opened on the Wardrobe tab.
class App {
  App(this.tester, {FakePicker? picker}) : picker = picker ?? FakePicker(result: photo());
  final WidgetTester tester;
  final FakePicker picker;
  final h = SessionHarness(stored: pair(1));
  late final ProviderContainer container;
  GoRouter get router => container.read(routerProvider);
  String get location => router.routerDelegate.currentConfiguration.uri.toString();

  /// Replies for GET/PATCH/DELETE of one item (default: the stored item).
  FakeReply? Function(String id, SentRequest r)? item;

  Future<void> start({FakeReply Function(SentRequest)? wardrobe, List<Override> overrides = const []}) async {
    h.backend.handlers[P.wardrobe] = wardrobe ?? (r) => JsonReply(200, pageJson(['a', 'b']));
    for (final id in ['a', 'b', 'new-1']) {
      h.backend.handlers['${P.wardrobe}/$id'] = (r) =>
          item?.call(id, r) ??
          (r.method == 'DELETE'
              ? JsonReply(200, {'ok': true})
              : JsonReply(200, {'item': itemJson(id, corrected: id == 'a')}));
    }
    h.backend.handlers['/api/v1/media/users/u1/a_thumb.webp'] = (r) =>
        BytesReply(200, fixtureBytes('plain_landscape.jpg'));
    container = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(picker),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
        ...overrides,
      ],
    );
    addTearDown(container.dispose);
    unawaited(h.session.restore());
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AtlasApp()));
    await settle();
    router.go(AtlasRoutes.wardrobe);
    await settle();
  }

  Future<void> settle() async {
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 2)));
    }
  }

  /// Scrolls the topmost scrollable that holds [f] (lazy lists build their
  /// children only near the viewport), then taps it.
  Future<void> reveal(Finder f, {required Type screen}) async {
    await tester.pump(const Duration(seconds: 1)); // any route transition done
    final scroll = find.descendant(of: find.byType(screen), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(f, 150, scrollable: scroll);
    await tester.runAsync(() => Scrollable.ensureVisible(tester.element(f), alignment: 0.5));
    await tester.pump();
    await tester.tap(f);
    await settle();
  }

  Future<void> tap(Finder f) async {
    await tester.ensureVisible(f);
    await tester.tap(f);
    await settle();
  }
}
