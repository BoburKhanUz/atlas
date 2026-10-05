import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/wardrobe_list_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'wardrobe_fixtures.dart';

Future<(ProviderContainer, SessionHarness)> start(FakeReply Function(SentRequest r) handler) async {
  final h = SessionHarness(stored: pair(1));
  h.backend.handlers[P.wardrobe] = handler;
  final c = ProviderContainer(overrides: appOverrides(h));
  addTearDown(c.dispose);
  await h.session.restore();
  c.listen(wardrobeListProvider, (_, _) {});
  await settle(c);
  return (c, h);
}

Future<void> settle(ProviderContainer c) async {
  for (var i = 0; i < 50; i++) {
    await pumpEventQueue();
    final s = c.read(wardrobeListProvider).status;
    if (s == ListStatus.ready) return;
  }
}

void main() {
  test('first page: newest first, cursor kept, Bearer sent, page size 30', () async {
    final (c, h) = await start((r) => JsonReply(200, pageJson(['a', 'b'], next: 'cur-2')));
    final s = c.read(wardrobeListProvider);
    expect(s.items.map((i) => i.id), ['a', 'b']);
    expect(s.hasMore, isTrue);
    final r = h.backend.to(P.wardrobe).single;
    expect(r.uri.queryParameters, {'limit': '30'});
    expect(r.header('Authorization'), 'Bearer ${access(1)}');
  });

  test('load more uses the cursor, appends, stops at the end, never duplicates', () async {
    final (c, h) = await start(
      (r) => r.uri.queryParameters['cursor'] == null
          ? JsonReply(200, pageJson(['a', 'b'], next: 'cur-2'))
          : JsonReply(200, pageJson(['b', 'c'])),
    );
    await c.read(wardrobeListProvider.notifier).loadMore();
    expect(c.read(wardrobeListProvider).items.map((i) => i.id), ['a', 'b', 'c']);
    expect(c.read(wardrobeListProvider).hasMore, isFalse);
    expect(h.backend.to(P.wardrobe).last.uri.queryParameters['cursor'], 'cur-2');
    await c.read(wardrobeListProvider.notifier).loadMore();
    expect(h.backend.calls(P.wardrobe), 2, reason: 'no request past the last page');
  });

  test('category filter is sent as the contract parameter; "all" sends none', () async {
    final (c, h) = await start(
      (r) => JsonReply(200, pageJson(['s1'], category: r.uri.queryParameters['category'] ?? 'shirt')),
    );
    await c.read(wardrobeListProvider.notifier).setCategory('shoes');
    expect(h.backend.to(P.wardrobe).last.uri.queryParameters['category'], 'shoes');
    expect(c.read(wardrobeListProvider).category, 'shoes');
    await c.read(wardrobeListProvider.notifier).setCategory('all');
    expect(h.backend.to(P.wardrobe).last.uri.queryParameters.containsKey('category'), isFalse);
  });

  test('a slow answer for an old category never overwrites the new one', () async {
    final gate = Gate();
    final (c, h) = await start((r) => JsonReply(200, pageJson(['x'])));
    h.backend.handlers[P.wardrobe] = (r) async {
      if (r.uri.queryParameters['category'] == 'bag') {
        await gate.future;
        return JsonReply(200, pageJson(['old-bag'], category: 'bag'));
      }
      return JsonReply(200, pageJson(['new-shoe'], category: 'shoes'));
    };
    final list = c.read(wardrobeListProvider.notifier);
    final slow = list.setCategory('bag');
    await pumpEventQueue();
    await list.setCategory('shoes');
    gate.open();
    await slow;
    expect(c.read(wardrobeListProvider).items.map((i) => i.id), ['new-shoe']);
  });

  test('offline first load → failure state; refresh recovers', () async {
    var online = false;
    final (c, _) = await start(
      (r) => online ? JsonReply(200, pageJson(['a'])) : TransportFailure(DioExceptionType.connectionError),
    );
    expect(c.read(wardrobeListProvider).failure, isA<ApiUnreachableFailure>());
    online = true;
    await c.read(wardrobeListProvider.notifier).refresh();
    expect(c.read(wardrobeListProvider).failure, isNull);
    expect(c.read(wardrobeListProvider).items, hasLength(1));
  });

  test('a failed refresh or next page keeps the items shown', () async {
    var fail = false;
    final (c, _) = await start(
      (r) => fail ? JsonReply(500, errorBody('INTERNAL')) : JsonReply(200, pageJson(['a'], next: 'n')),
    );
    fail = true;
    await c.read(wardrobeListProvider.notifier).refresh();
    expect(c.read(wardrobeListProvider).items, hasLength(1));
    expect(c.read(wardrobeListProvider).loadMoreFailure, isA<ApiHttpFailure>());
    await c.read(wardrobeListProvider.notifier).loadMore();
    expect(c.read(wardrobeListProvider).items, hasLength(1));
    expect(c.read(wardrobeListProvider).failure, isNull);
  });

  test('insert respects the active category and dedupes; remove drops the item', () async {
    final (c, _) = await start((r) => JsonReply(200, pageJson(['a'])));
    final list = c.read(wardrobeListProvider.notifier);
    final item = c.read(wardrobeListProvider).items.first;
    list.insert(item);
    expect(c.read(wardrobeListProvider).items, hasLength(1));
    list.remove('a');
    expect(c.read(wardrobeListProvider).items, isEmpty);
  });

  test('refresh while refreshing is a no-op (one request)', () async {
    final gate = Gate();
    final (c, h) = await start((r) => JsonReply(200, pageJson(['a'])));
    h.backend.gates[P.wardrobe] = gate;
    final list = c.read(wardrobeListProvider.notifier);
    final f1 = list.refresh();
    final f2 = list.refresh();
    gate.open();
    await Future.wait([f1, f2]);
    expect(h.backend.calls(P.wardrobe), 2, reason: 'initial load + one refresh');
  });
}
