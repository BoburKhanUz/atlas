import 'dart:convert';

import 'package:atlas_mobile/features/outfits/presentation/outfit_detail_controller.dart';
import 'package:atlas_mobile/features/outfits/presentation/outfit_list_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'outfit_fixtures.dart';

const path = '${P.outfits}/o1';

class Detail {
  Detail() {
    c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    h.backend.handlers[path] = (r) => switch (r.method) {
      'GET' => getReply,
      'PATCH' => patchReplies[(patches++).clamp(0, patchReplies.length - 1)],
      _ => deleteReply,
    };
    h.backend.handlers[P.outfits] = (_) => JsonReply(200, listJson([summaryJson('o1')]));
  }

  final h = SessionHarness(stored: pair(1));
  late final ProviderContainer c;
  FakeReply getReply = JsonReply(200, detailJson('o1'));
  var patchReplies = <FakeReply>[JsonReply(200, rowJson('o1', name: 'Juma'))];
  var patches = 0;
  FakeReply deleteReply = JsonReply(200, {'ok': true});

  OutfitDetailController get ctl => c.read(outfitDetailControllerProvider('o1').notifier);
  OutfitDetailState get state => c.read(outfitDetailControllerProvider('o1'));
  List<Map<String, Object?>> get patchBodies => h.backend
      .to(path)
      .where((r) => r.method == 'PATCH')
      .map((r) => jsonDecode(r.bodyText) as Map<String, Object?>)
      .toList();

  Future<void> open() async {
    await h.session.restore();
    c.listen(outfitDetailControllerProvider('o1'), (_, _) {});
    for (var i = 0; i < 20 && state.status == OutfitDetailStatus.loading; i++) {
      await pumpEventQueue();
    }
  }
}

void main() {
  test('rename: trimmed, one PATCH {name}; invalid names send nothing', () async {
    final d = Detail();
    await d.open();
    expect(await d.ctl.rename('   '), isFalse);
    expect(await d.ctl.rename('x' * 81), isFalse);
    expect(await d.ctl.rename('  Juma  '), isTrue);
    expect(d.patchBodies, [
      {'name': 'Juma'},
    ]);
    expect(d.state.outfit!.name, 'Juma');
    expect(OutfitName.valid('x' * 80), hasLength(80));
  });

  test('unsave / save: PATCH {isSaved}', () async {
    final d = Detail();
    d.patchReplies = [JsonReply(200, rowJson('o1', isSaved: false)), JsonReply(200, rowJson('o1'))];
    await d.open();
    await d.ctl.setSaved(saved: false);
    expect(d.state.outfit!.isSaved, isFalse);
    await d.ctl.setSaved(saved: true);
    expect(d.patchBodies, [
      {'isSaved': false},
      {'isSaved': true},
    ]);
  });

  test('a mutation refreshes the outfit lists', () async {
    final d = Detail();
    await d.open();
    d.c.listen(outfitListProvider(true), (_, _) {});
    for (var i = 0; i < 10 && d.c.read(outfitListProvider(true)).status == OutfitListStatus.loading; i++) {
      await pumpEventQueue();
    }
    final before = d.h.backend.calls(P.outfits);
    await d.ctl.setSaved(saved: false);
    for (var i = 0; i < 10; i++) {
      await pumpEventQueue();
    }
    expect(d.h.backend.calls(P.outfits), greaterThan(before));
  });

  test('delete → DELETE once → deleted; already gone (404) counts as deleted', () async {
    final d = Detail();
    await d.open();
    await d.ctl.delete();
    expect(d.state.status, OutfitDetailStatus.deleted);
    expect(d.h.backend.to(path).where((r) => r.method == 'DELETE'), hasLength(1));
    final e = Detail()..deleteReply = JsonReply(404, errorBody('NOT_FOUND'));
    await e.open();
    await e.ctl.delete();
    expect(e.state.status, OutfitDetailStatus.deleted);
  });

  test('404 on open or on a PATCH → notFound', () async {
    final d = Detail()..getReply = JsonReply(404, errorBody('NOT_FOUND'));
    await d.open();
    expect(d.state.status, OutfitDetailStatus.notFound);
    final e = Detail()..patchReplies = [JsonReply(404, errorBody('NOT_FOUND'))];
    await e.open();
    await e.ctl.setSaved(saved: false);
    expect(e.state.status, OutfitDetailStatus.notFound);
  });

  test('failure keeps the outfit; never retried automatically', () async {
    final d = Detail()..patchReplies = [TransportFailure(DioExceptionType.connectionError)];
    await d.open();
    await d.ctl.rename('Juma');
    expect(d.state.status, OutfitDetailStatus.ready);
    expect(d.state.failure, isNotNull);
    expect(d.state.outfit!.name, isNull);
    expect(d.patchBodies, hasLength(1));
  });

  test('double tap → one request; actions are exclusive', () async {
    final d = Detail();
    await d.open();
    d.h.backend.gates[path] = Gate();
    final a = d.ctl.setSaved(saved: false);
    final b = d.ctl.setSaved(saved: false);
    final c = d.ctl.delete();
    await pumpEventQueue();
    d.h.backend.gates[path]!.open();
    await Future.wait([a, b, c]);
    expect(d.h.backend.to(path).where((r) => r.method != 'GET'), hasLength(1));
  });

  test('401 → refresh → the PATCH is re-sent once', () async {
    final d = Detail();
    await d.open();
    d.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
    d.patchReplies = [JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(200, rowJson('o1', name: 'Juma'))];
    await d.ctl.rename('Juma');
    expect(d.state.outfit!.name, 'Juma');
    expect(d.h.backend.to(path).where((r) => r.method == 'PATCH').map((r) => r.header('Authorization')), [
      'Bearer ${access(1)}',
      'Bearer ${access(2)}',
    ]);
  });
}
