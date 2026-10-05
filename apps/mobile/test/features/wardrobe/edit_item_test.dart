import 'dart:convert';

import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/edit_item_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'wardrobe_fixtures.dart';

const itemPath = '${P.wardrobe}/i1';

class Editor {
  Editor() {
    h = SessionHarness(stored: pair(1));
    c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    getReply = JsonReply(200, {'item': itemJson('i1')});
    h.backend.handlers[itemPath] = (r) {
      if (r.method == 'GET') return getReply;
      final reply = patchReplies[(patchCalls++).clamp(0, patchReplies.length - 1)];
      return reply;
    };
  }

  late final SessionHarness h;
  late final ProviderContainer c;
  late FakeReply getReply;
  var patchReplies = <FakeReply>[];
  var patchCalls = 0;

  EditItemController get ctl => c.read(editItemControllerProvider('i1').notifier);
  EditState get state => c.read(editItemControllerProvider('i1'));
  List<SentRequest> get patches => h.backend.to(itemPath).where((r) => r.method == 'PATCH').toList();
  List<Map<String, Object?>> get patchBodies =>
      patches.map((r) => jsonDecode(r.bodyText) as Map<String, Object?>).toList();

  Future<void> open() async {
    await h.session.restore();
    c.listen(editItemControllerProvider('i1'), (_, _) {});
    for (var i = 0; i < 20 && state.status == EditStatus.loading; i++) {
      await pumpEventQueue();
    }
  }
}

Map<String, Object?> patched(Map<String, Object?> changes, {List<Map<String, Object?>>? log}) {
  final json = itemJson(
    'i1',
    correctionLog:
        log ??
        [
          for (final e in changes.entries)
            {'field': e.key, 'from': '"x"', 'to': jsonEncode(e.value), 'at': '2026-10-05T11:00:00.000Z'},
        ],
  );
  return {
    'item': {...json, ...changes},
  };
}

void main() {
  test('one PATCH per Save with only the changed fields; list, detail and review updated', () async {
    final e = Editor();
    await e.open();
    expect(e.state.status, EditStatus.editing);
    e.patchReplies = [
      JsonReply(
        200,
        patched({
          'fit': 'slim',
          'season': ['summer', 'spring'],
        }),
      ),
    ];
    e.ctl
      ..set(ItemAttribute.fit, 'slim')
      ..set(ItemAttribute.season, ['summer', 'spring']);
    await e.ctl.save();
    expect(e.state.status, EditStatus.saved);
    expect(e.patchBodies, [
      {
        'fit': 'slim',
        'season': ['summer', 'spring'],
      },
    ]);
    expect(e.patches.single.header('Authorization'), 'Bearer ${access(1)}');
    expect(e.c.read(wardrobeItemUpdatesProvider)!.fit, 'slim');
    expect(e.c.read(wardrobeItemUpdatesProvider)!.wasCorrected, isTrue);
  });

  test('nothing changed (or only a reordered list) → no request at all', () async {
    final e = Editor();
    await e.open();
    await e.ctl.save();
    expect(e.state.status, EditStatus.saved);
    final e2 = Editor();
    await e2.open();
    e2.ctl.set(ItemAttribute.colors, ['navy', 'white']); // same set as ['white','navy']
    e2.ctl.set(ItemAttribute.fit, 'slim');
    e2.ctl.set(ItemAttribute.fit, 'regular'); // back to the original
    await e2.ctl.save();
    expect(e.patches, isEmpty);
    expect(e2.patches, isEmpty);
  });

  test('network failure → failed, edits kept; Retry sends the same body once (never automatically)', () async {
    final e = Editor();
    await e.open();
    e.patchReplies = [
      TransportFailure(DioExceptionType.connectionError),
      JsonReply(200, patched({'fit': 'slim'})),
    ];
    e.ctl.set(ItemAttribute.fit, 'slim');
    await e.ctl.save();
    expect(e.state.status, EditStatus.failed);
    expect(e.state.draft!.fit, 'slim');
    expect(e.patches, hasLength(1), reason: 'no automatic retry');
    await e.ctl.save();
    expect(e.state.status, EditStatus.saved);
    expect(e.patchBodies, [
      {'fit': 'slim'},
      {'fit': 'slim'},
    ]);
  });

  test('401 → refresh → the PATCH is re-sent once with the new token', () async {
    final e = Editor();
    await e.open();
    e.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
    e.patchReplies = [
      JsonReply(401, errorBody('UNAUTHORIZED')),
      JsonReply(200, patched({'fit': 'slim'})),
    ];
    e.ctl.set(ItemAttribute.fit, 'slim');
    await e.ctl.save();
    expect(e.state.status, EditStatus.saved);
    expect(e.h.backend.calls(P.refresh), 1);
    expect(e.patches.map((r) => r.header('Authorization')), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    expect(e.patches.map((r) => r.header('Cookie')), [null, null], reason: 'never cookies');
  });

  test('terminal session error → edits discarded, signed out', () async {
    final e = Editor();
    await e.open();
    e.h.backend.script(P.refresh, [JsonReply(401, errorBody('SESSION_REVOKED'))]);
    e.patchReplies = [JsonReply(401, errorBody('UNAUTHORIZED'))];
    e.ctl.set(ItemAttribute.fit, 'slim');
    await e.ctl.save();
    expect(e.state.status, EditStatus.loadFailed);
    expect(e.state.draft, isNull);
    expect(e.h.session.state, isA<SessionExpired>());
  });

  test('404 (deleted elsewhere / not yours) → notFound, removed from the list, list refreshed', () async {
    final e = Editor();
    e.h.backend.handlers[P.wardrobe] = (_) => JsonReply(200, pageJson(['i1', 'i2']));
    await e.open();
    e.c.listen(wardrobeListProvider, (_, _) {});
    for (var i = 0; i < 20 && e.c.read(wardrobeListProvider).items.length != 2; i++) {
      await pumpEventQueue();
    }
    expect(e.c.read(wardrobeListProvider).items.map((i) => i.id), ['i1', 'i2']);
    e.h.backend.handlers[P.wardrobe] = (_) => JsonReply(200, pageJson(['i2']));
    final listCalls = e.h.backend.calls(P.wardrobe);
    e.patchReplies = [JsonReply(404, errorBody('NOT_FOUND'))];
    final listGate = e.h.backend.gates[P.wardrobe] = Gate(); // the refresh is held back
    e.ctl.set(ItemAttribute.fit, 'slim');
    await e.ctl.save();
    expect(e.state.status, EditStatus.notFound);
    expect(e.c.read(wardrobeListProvider).items.map((i) => i.id), ['i2'], reason: 'removed at once');
    listGate.open();
    await pumpEventQueue();
    expect(e.c.read(wardrobeListProvider).items.map((i) => i.id), ['i2']);
    expect(e.h.backend.calls(P.wardrobe), greaterThan(listCalls), reason: 'list re-fetched');
    expect(e.patches, hasLength(1));
  });

  test('item already missing when the editor opens → notFound, no PATCH', () async {
    final e = Editor()..getReply = JsonReply(404, errorBody('NOT_FOUND'));
    await e.open();
    expect(e.state.status, EditStatus.notFound);
    expect(e.patches, isEmpty);
  });

  test('400 VALIDATION_ERROR → field errors on the right attributes, edits kept', () async {
    final e = Editor();
    await e.open();
    e.patchReplies = [
      JsonReply(
        400,
        errorBody(
          'VALIDATION_ERROR',
          details: [
            {'path': 'fit', 'message': 'Invalid enum value'},
            {'path': 'unknownThing', 'message': 'x'},
          ],
        ),
      ),
    ];
    e.ctl.set(ItemAttribute.fit, 'slim');
    await e.ctl.save();
    expect(e.state.status, EditStatus.failed);
    expect(e.state.fieldErrors.keys, [ItemAttribute.fit]);
    expect(e.state.draft!.fit, 'slim');
  });

  test('double tap on Save → exactly one request', () async {
    final e = Editor();
    await e.open();
    final gate = Gate();
    e.h.backend.gates[itemPath] = gate;
    e.patchReplies = [
      JsonReply(200, patched({'fit': 'slim'})),
    ];
    e.ctl.set(ItemAttribute.fit, 'slim');
    final first = e.ctl.save();
    final second = e.ctl.save();
    e.ctl.set(ItemAttribute.fit, 'oversized'); // ignored while saving
    await pumpEventQueue();
    gate.open();
    await Future.wait([first, second]);
    expect(e.patches, hasLength(1));
    expect(e.state.status, EditStatus.saved);
  });

  test('a value outside the contract is never sent; limits block Save', () async {
    final e = Editor();
    await e.open();
    e.ctl.set(ItemAttribute.fit, 'baggy-ish');
    await e.ctl.save();
    e.ctl
      ..set(ItemAttribute.fit, 'regular')
      ..set(ItemAttribute.colors, ['white', 'navy', 'black', 'red', 'green', 'blue']);
    await e.ctl.save();
    e.ctl
      ..set(ItemAttribute.colors, ['white'])
      ..set(ItemAttribute.season, <String>[]);
    await e.ctl.save();
    expect(e.patches, isEmpty);
  });
}
