import 'dart:convert';

import 'package:atlas_mobile/features/wardrobe/data/pending_upload_store.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/add_item_screen.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/edit_item_screen.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/item_detail_screen.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'app_harness.dart';
import 'wardrobe_fixtures.dart';

/// Item 'a' with low confidence on fit and gender only.
const twoLow = {'category': 0.92, 'color': 0.9, 'fit': 0.15, 'gender': 0.3};

Finder inRow(String field, String text) =>
    find.descendant(of: find.byKey(Key('review.$field')), matching: find.text(text));

/// The app with item 'a' (two low-confidence attributes) whose PATCH
/// answers with the changed fields applied.
App appWithLowItem(WidgetTester tester) {
  final app = App(tester);
  app.item = (id, r) {
    if (r.method == 'PATCH') {
      final changes = jsonDecode(r.bodyText) as Map<String, Object?>;
      return JsonReply(200, {
        'item': {
          ...itemJson(
            id,
            confidences: twoLow,
            correctionLog: [
              for (final e in changes.entries)
                {'field': e.key, 'from': '"regular"', 'to': jsonEncode(e.value), 'at': '2026-10-05T11:00:00.000Z'},
            ],
          ),
          ...changes,
        },
      });
    }
    return r.method == 'GET' ? JsonReply(200, {'item': itemJson(id, confidences: twoLow)}) : null;
  };
  return app;
}

void main() {
  testWidgets('after upload: needs-correction review; "To‘g‘ri" settles it without any request', (tester) async {
    final app = App(tester);
    await app.start(
      wardrobe: (r) => r.method == 'POST'
          ? JsonReply(201, uploadJson('new-1', confidences: twoLow))
          : JsonReply(200, pageJson(const [])),
    );
    await app.tap(find.byKey(const Key('wardrobe.add')));
    await app.tap(find.byKey(const Key('add.gallery')));
    await app.tap(find.byKey(const Key('add.upload')));
    expect(find.byKey(const Key('add.needsCorrection')), findsOneWidget);
    expect(find.byKey(const Key('review.banner')), findsOneWidget);
    expect(inRow('fit', 'Past ishonch'), findsOneWidget);
    expect(inRow('category', 'Yuqori ishonch'), findsOneWidget);
    final sent = app.h.backend.sent.length;
    await app.tap(inRow('fit', 'To‘g‘ri'));
    await app.tap(inRow('gender', 'To‘g‘ri'));
    expect(find.byKey(const Key('add.completed')), findsOneWidget);
    expect(find.byKey(const Key('review.banner')), findsNothing);
    expect(app.h.backend.sent.length, sent, reason: 'acknowledgement is client-session-only');
  });

  testWidgets('after upload: "Tuzatish" opens the editor; Save → one PATCH → review settled', (tester) async {
    final app = appWithLowItem(tester);
    await app.start(
      wardrobe: (r) => r.method == 'POST'
          ? JsonReply(201, uploadJson('new-1', confidences: twoLow))
          : JsonReply(200, pageJson(const [])),
    );
    await app.tap(find.byKey(const Key('wardrobe.add')));
    await app.tap(find.byKey(const Key('add.gallery')));
    await app.tap(find.byKey(const Key('add.upload')));
    await app.tap(inRow('fit', 'Tuzatish'));
    expect(find.byType(EditItemScreen), findsOneWidget);
    await app.reveal(find.byKey(const Key('edit.fit.slim')), screen: EditItemScreen);
    await app.reveal(find.byKey(const Key('edit.gender.female')), screen: EditItemScreen);
    await app.tap(find.byKey(const Key('edit.save')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(EditItemScreen), findsNothing);
    final patches = app.h.backend.to('${P.wardrobe}/new-1').where((r) => r.method == 'PATCH').toList();
    expect(patches, hasLength(1));
    expect(jsonDecode(patches.single.bodyText), {'fit': 'slim', 'gender': 'female'});
    expect(find.byKey(const Key('add.completed')), findsOneWidget);
    expect(inRow('fit', 'Siz tuzatgansiz'), findsOneWidget);
  });

  testWidgets('detail: acknowledgement lasts for this visit only and is never sent', (tester) async {
    final app = appWithLowItem(tester);
    await app.start();
    await app.tap(find.byKey(const Key('wardrobe.item.a')));
    final detail = find.byType(ItemDetailScreen);
    final scroll = find.descendant(of: detail, matching: find.byType(Scrollable));
    await app.reveal(inRow('fit', 'To‘g‘ri'), screen: ItemDetailScreen);
    expect(inRow('fit', 'To‘g‘ri'), findsNothing);
    app.router.pop();
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    await app.tap(find.byKey(const Key('wardrobe.item.a')));
    await tester.scrollUntilVisible(inRow('fit', 'To‘g‘ri'), 150, scrollable: scroll.first);
    expect(inRow('fit', 'To‘g‘ri'), findsOneWidget, reason: 'shown again on the next visit');
    expect(app.h.backend.sent.where((r) => r.method == 'PATCH'), isEmpty);
  });

  testWidgets('editor: limits disable extra colours; failure keeps edits and offers Retry', (tester) async {
    final app = App(tester);
    var patches = 0;
    app.item = (id, r) {
      if (r.method != 'PATCH') return null;
      patches++;
      return patches == 1
          ? JsonReply(503, errorBody('INTERNAL_ERROR'))
          : JsonReply(200, {
              'item': {
                ...itemJson(id),
                'colors': ['white', 'navy', 'black'],
              },
            });
    };
    await app.start();
    await app.tap(find.byKey(const Key('wardrobe.item.b')));
    await app.tap(find.byKey(const Key('item.edit')));
    expect(find.byType(EditItemScreen), findsOneWidget);
    for (final c in ['black', 'red', 'green']) {
      await app.reveal(find.byKey(Key('edit.colors.$c')), screen: EditItemScreen);
    }
    final blue = tester.widget<FilterChip>(find.byKey(const Key('edit.colors.blue')));
    expect(blue.onSelected, isNull, reason: 'at most 5 colours');
    await app.reveal(find.byKey(const Key('edit.colors.red')), screen: EditItemScreen);
    await app.reveal(find.byKey(const Key('edit.colors.green')), screen: EditItemScreen);
    await app.tap(find.byKey(const Key('edit.save')));
    expect(find.byKey(const Key('edit.failure')), findsOneWidget);
    expect(find.text('Qayta urinish'), findsOneWidget);
    expect(tester.widget<FilterChip>(find.byKey(const Key('edit.colors.black'))).selected, isTrue);
    await app.tap(find.byKey(const Key('edit.save')));
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    expect(find.byType(EditItemScreen), findsNothing);
    expect(patches, 2);
  });

  testWidgets('list: a low-confidence item shows a "check" badge', (tester) async {
    final app = App(tester);
    await app.start(
      wardrobe: (r) => JsonReply(200, {
        'items': [itemJson('a', confidences: twoLow), itemJson('b')],
        'nextCursor': null,
      }),
    );
    expect(find.byKey(const Key('wardrobe.review.a')), findsOneWidget);
    expect(find.byKey(const Key('wardrobe.review.b')), findsNothing);
  });

  testWidgets('interrupted upload from an earlier run: notice, dismiss, and add again', (tester) async {
    final app = App(tester);
    app.h.kv.values[PendingUploadStore.keyFor('u1')] = PendingUpload(
      userId: 'u1',
      idempotencyKey: 'k-12345678',
      sha256: 'h',
      filename: 'IMG_0042.jpg',
      createdAt: DateTime.now().toUtc().subtract(const Duration(minutes: 3)),
    ).encode();
    await app.start(overrides: [processStartedAtProvider.overrideWithValue(DateTime.now().toUtc())]);
    expect(find.byKey(const Key('wardrobe.interrupted')), findsOneWidget);
    await app.tap(find.byKey(const Key('wardrobe.interrupted.add')));
    expect(find.byType(AddItemScreen), findsOneWidget);
    app.router.pop();
    await tester.pump(const Duration(seconds: 1));
    await app.settle();
    await app.tap(find.byKey(const Key('wardrobe.interrupted.dismiss')));
    expect(find.byKey(const Key('wardrobe.interrupted')), findsNothing);
  });

  for (final (name, size, scale) in [
    ('small phone', const Size(320, 568), 1.0),
    ('2× text', const Size(375, 667), 2.0),
  ]) {
    testWidgets('layouts hold ($name): review step and editor', (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final app = appWithLowItem(tester);
      await app.start(
        wardrobe: (r) => r.method == 'POST'
            ? JsonReply(201, uploadJson('new-1', confidences: lowConfidences))
            : JsonReply(200, pageJson(const [])),
      );
      await app.tap(find.byKey(const Key('wardrobe.add')));
      await app.tap(find.byKey(const Key('add.gallery')));
      await app.tap(find.byKey(const Key('add.upload')));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('add.needsCorrection')), findsOneWidget);
      await app.tap(find.byKey(const Key('add.edit')));
      expect(tester.takeException(), isNull);
      await app.reveal(find.byKey(const Key('edit.formality.formal')), screen: EditItemScreen);
      await app.tap(find.byKey(const Key('edit.save')));
      expect(tester.takeException(), isNull);
    });
  }
}
