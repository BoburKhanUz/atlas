import 'package:atlas_mobile/features/wardrobe/presentation/add_item_screen.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/item_detail_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'app_harness.dart';
import 'wardrobe_fixtures.dart';

void main() {
  testWidgets('list: items in a grid, category chips; a chip filters through the contract parameter', (tester) async {
    final app = App(tester);
    await app.start();
    expect(find.byKey(const Key('wardrobe.item.a')), findsOneWidget);
    expect(find.byKey(const Key('wardrobe.item.b')), findsOneWidget);
    await app.tap(find.byKey(const Key('wardrobe.category.shoes')));
    expect(app.h.backend.to(P.wardrobe).last.uri.queryParameters['category'], 'shoes');
  });

  testWidgets('empty wardrobe: explanation and an add action', (tester) async {
    final app = App(tester);
    await app.start(wardrobe: (r) => JsonReply(200, pageJson(const [])));
    expect(find.text('Garderob bo‘sh'), findsOneWidget);
    await app.tap(find.text('Kiyim qo‘shish'));
    expect(find.byType(AddItemScreen), findsOneWidget);
  });

  testWidgets('offline: offline state with retry', (tester) async {
    final app = App(tester);
    app.h.network.online = false;
    await app.start(wardrobe: (r) => TransportFailure(DioExceptionType.connectionError));
    expect(find.text('Internet aloqasi yo‘q', skipOffstage: false), findsWidgets);
  });

  testWidgets('item detail: attributes, corrections, delete with confirmation', (tester) async {
    final app = App(tester);
    await app.start();
    await app.tap(find.byKey(const Key('wardrobe.item.a')));
    expect(find.byWidgetPredicate((w) => w is ItemDetailScreen && w.id == 'a'), findsOneWidget);
    final detail = find.byType(ItemDetailScreen);
    final scroll = find.descendant(of: detail, matching: find.byType(Scrollable));
    await tester.scrollUntilVisible(find.byKey(const Key('item.correction')), 200, scrollable: scroll);
    expect(find.descendant(of: detail, matching: find.text('Futbolka')), findsOneWidget);
    expect(find.descendant(of: detail, matching: find.text('Oq, To‘q ko‘k')), findsOneWidget);
    expect(find.byKey(const Key('item.correction')), findsOneWidget);
    await app.tap(find.byKey(const Key('item.delete')));
    expect(find.text('Kiyimni o‘chirasizmi?'), findsOneWidget);
    await app.tap(find.byKey(const Key('item.confirmDelete')));
    await tester.pump(const Duration(seconds: 1)); // route transition done
    expect(app.h.backend.to('${P.wardrobe}/a').where((r) => r.method == 'DELETE'), hasLength(1));
    expect(find.byType(ItemDetailScreen), findsNothing);
    expect(find.byKey(const Key('wardrobe.item.a')), findsNothing);
  });

  testWidgets('add: gallery → preview → upload → success → open the item', (tester) async {
    final app = App(tester);
    await app.start(
      wardrobe: (r) => r.method == 'POST' ? JsonReply(201, uploadJson('new-1')) : JsonReply(200, pageJson(['a'])),
    );
    await app.tap(find.byKey(const Key('wardrobe.add')));
    expect(find.byType(AddItemScreen), findsOneWidget);
    expect(app.picker.calls, isEmpty, reason: 'no permission prompt before the user chooses a source');
    await app.tap(find.byKey(const Key('add.gallery')));
    expect(find.byKey(const Key('add.preview')), findsOneWidget);
    await app.tap(find.byKey(const Key('add.upload')));
    expect(find.byKey(const Key('add.completed')), findsOneWidget);
    await app.tap(find.byKey(const Key('add.open')));
    expect(find.byWidgetPredicate((w) => w is ItemDetailScreen && w.id == 'new-1'), findsOneWidget);
  });

  testWidgets('add: network failure shows Retry; Retry succeeds with the same key', (tester) async {
    final app = App(tester);
    var posts = 0;
    await app.start(
      wardrobe: (r) {
        if (r.method != 'POST') return JsonReply(200, pageJson(const []));
        posts++;
        return posts == 1 ? TransportFailure(DioExceptionType.connectionError) : JsonReply(201, uploadJson('new-1'));
      },
    );
    await app.tap(find.byKey(const Key('wardrobe.add')));
    await app.tap(find.byKey(const Key('add.camera')));
    await app.tap(find.byKey(const Key('add.upload')));
    expect(find.byKey(const Key('add.failure')), findsOneWidget);
    await app.tap(find.byKey(const Key('add.retry')));
    expect(find.byKey(const Key('add.completed')), findsOneWidget);
    final keys = app.h.backend.to(P.wardrobe).where((r) => r.method == 'POST').map((r) => r.header('Idempotency-Key'));
    expect(keys.toSet(), hasLength(1));
  });

  testWidgets('add: a rejected photo explains why and offers another one', (tester) async {
    final app = App(tester, picker: FakePicker(result: photo())..result = null);
    app.picker.result = null;
    await app.start();
    await app.tap(find.byKey(const Key('wardrobe.add')));
    app.picker.denied = true;
    await app.tap(find.byKey(const Key('add.camera')));
    expect(find.textContaining('Kameraga ruxsat berilmagan'), findsOneWidget);
    await app.tap(find.byKey(const Key('add.pickAgain')));
    expect(find.byKey(const Key('add.camera')), findsOneWidget);
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('layouts hold ($name): list, detail, add flow', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final app = App(tester);
      await app.start(
        wardrobe: (r) =>
            r.method == 'POST' ? JsonReply(201, uploadJson('new-1')) : JsonReply(200, pageJson(['a', 'b'])),
      );
      expect(tester.takeException(), isNull);
      await app.tap(find.byKey(const Key('wardrobe.item.a')));
      expect(tester.takeException(), isNull);
      app.router.pop();
      await app.settle();
      await tester.pump(const Duration(seconds: 1)); // route transition done
      await app.tap(find.byKey(const Key('wardrobe.add')));
      expect(tester.takeException(), isNull);
      await app.tap(find.byKey(const Key('add.gallery')));
      await app.tap(find.byKey(const Key('add.upload')));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('add.completed')), findsOneWidget);
    });
  }
}
