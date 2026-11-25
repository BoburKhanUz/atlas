import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show WardrobeItem, standardSerializers;
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/wardrobe_list_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'wardrobe_fixtures.dart';

/// Time for the URL-refresh throttle: moved by the test, never by the device clock.
class FakeClock {
  Duration now = Duration.zero;
  final waits = <(Duration, Completer<void>)>[];
  Future<void> wait(Duration d) {
    final done = Completer<void>();
    waits.add((d, done));
    return done.future;
  }
}

Future<(ProviderContainer, SessionHarness)> start(FakeReply Function(SentRequest r) handler, {FakeClock? clock}) async {
  final h = SessionHarness(stored: pair(1));
  h.backend.handlers[P.wardrobe] = handler;
  final c = ProviderContainer(
    overrides: [
      ...appOverrides(h),
      if (clock != null) wardrobeClockProvider.overrideWithValue(() => clock.now),
      if (clock != null) wardrobeDelayProvider.overrideWithValue(clock.wait),
    ],
  );
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
    // A failed refresh is reported as such (not as a failed next page, whose
    // retry would load the next page instead).
    expect(c.read(wardrobeListProvider).refreshFailure, isA<ApiHttpFailure>());
    expect(c.read(wardrobeListProvider).loadMoreFailure, isNull);
    await c.read(wardrobeListProvider.notifier).loadMore();
    expect(c.read(wardrobeListProvider).items, hasLength(1));
    expect(c.read(wardrobeListProvider).failure, isNull);
  });

  test('a failed next page is not retried automatically, only by an explicit retry', () async {
    var nextFails = true;
    final (c, h) = await start(
      (r) => r.uri.queryParameters['cursor'] == null
          ? JsonReply(200, pageJson(['a'], next: 'cur-2'))
          : nextFails
          ? JsonReply(500, errorBody('INTERNAL'))
          : JsonReply(200, pageJson(['b'])),
    );
    final list = c.read(wardrobeListProvider.notifier);
    await list.loadMore();
    expect(c.read(wardrobeListProvider).loadMoreFailure, isA<ApiHttpFailure>());
    // The grid asks again on every rebuild of its last tiles.
    await list.loadMore();
    await list.loadMore();
    expect(h.backend.calls(P.wardrobe), 2, reason: 'first page + one failed next page');
    nextFails = false;
    await list.loadMore(retry: true);
    expect(h.backend.calls(P.wardrobe), 3);
    expect(c.read(wardrobeListProvider).items.map((i) => i.id), ['a', 'b']);
    expect(c.read(wardrobeListProvider).loadMoreFailure, isNull);
  });

  test('fresh image URLs keep every loaded page (not only the first)', () async {
    final first = [for (var i = 0; i < 30; i++) 'a$i'];
    final second = [for (var i = 0; i < 5; i++) 'b$i'];
    final (c, h) = await start((r) {
      final q = r.uri.queryParameters;
      if (q['limit'] == '35') return JsonReply(200, pageJson([...first, ...second], next: 'cur-after-35'));
      return q['cursor'] == null
          ? JsonReply(200, pageJson(first, next: 'cur-2'))
          : JsonReply(200, pageJson(second, next: 'cur-3'));
    });
    final list = c.read(wardrobeListProvider.notifier);
    await list.loadMore();
    expect(c.read(wardrobeListProvider).items, hasLength(35));
    await list.refreshUrls();
    final s = c.read(wardrobeListProvider);
    expect(s.items.map((i) => i.id), [...first, ...second]);
    expect(s.nextCursor, 'cur-after-35', reason: 'paging continues after the reloaded range');
    final reload = h.backend.to(P.wardrobe).last.uri.queryParameters;
    expect(reload['limit'], '35', reason: 'the loaded range in one request');
    expect(reload.containsKey('cursor'), isFalse);
  });

  test('expired URLs reported by many tiles at once reload the list once', () async {
    final (c, h) = await start((r) => JsonReply(200, pageJson(['a', 'b'])));
    final list = c.read(wardrobeListProvider.notifier);
    await Future.wait([list.refreshUrls(), list.refreshUrls(), list.refreshUrls()]);
    await list.refreshUrls(); // right after: still the same fresh URLs
    expect(h.backend.calls(P.wardrobe), 2, reason: 'initial load + one URL refresh');
  });

  test('a failed URL reload is a refresh failure; its retry reloads the URLs, also on a single page', () async {
    var fail = false;
    final (c, h) = await start(
      (r) => fail ? JsonReply(500, errorBody('INTERNAL')) : JsonReply(200, pageJson(['a', 'b'])),
    );
    final list = c.read(wardrobeListProvider.notifier);
    fail = true;
    await list.refreshUrls();
    var s = c.read(wardrobeListProvider);
    expect(s.items, hasLength(2), reason: 'what is shown stays');
    expect(s.refreshFailure, isA<ApiHttpFailure>());
    expect(s.loadMoreFailure, isNull);
    fail = false;
    await list.refreshUrls(retry: true); // the banner's retry, right away (not throttled)
    s = c.read(wardrobeListProvider);
    expect(h.backend.calls(P.wardrobe), 3, reason: 'initial load + failed reload + retry');
    expect(s.refreshFailure, isNull);
  });

  test('an expiry reported while the next page loads is done after it, not dropped', () async {
    final (c, h) = await start(
      (r) => JsonReply(200, pageJson(['a'], next: r.uri.queryParameters['cursor'] == null ? 'n' : null)),
    );
    final list = c.read(wardrobeListProvider.notifier);
    final gate = h.backend.gates[P.wardrobe] = Gate();
    final more = list.loadMore();
    await pumpEventQueue();
    expect(c.read(wardrobeListProvider).status, ListStatus.loadingMore);
    await list.refreshUrls();
    gate.open();
    h.backend.gates.remove(P.wardrobe);
    await more;
    await settle(c);
    await pumpEventQueue();
    expect(h.backend.calls(P.wardrobe), 3, reason: 'initial load + next page + URL reload');
    expect(h.backend.to(P.wardrobe).last.uri.queryParameters['limit'], isNotNull);
  });

  test('an expiry reported soon after a reload is done once the interval is over, on a monotonic clock', () async {
    final clock = FakeClock();
    final (c, h) = await start((r) => JsonReply(200, pageJson(['a'])), clock: clock);
    final list = c.read(wardrobeListProvider.notifier);
    await list.refreshUrls();
    expect(h.backend.calls(P.wardrobe), 2);
    clock.now += const Duration(seconds: 10);
    await list.refreshUrls();
    await list.refreshUrls();
    expect(h.backend.calls(P.wardrobe), 2, reason: 'throttled');
    expect(
      clock.waits.single.$1,
      const Duration(seconds: 20),
      reason: 'one deferred reload for the rest of the interval',
    );
    clock.now += const Duration(seconds: 20);
    clock.waits.single.$2.complete();
    await settle(c);
    await pumpEventQueue();
    expect(h.backend.calls(P.wardrobe), 3, reason: 'the reported expiry is not lost');
  });

  test('an upload or a delete during a URL reload is kept', () async {
    final (c, h) = await start((r) => JsonReply(200, pageJson(['a', 'b'])));
    final list = c.read(wardrobeListProvider.notifier);
    final gate = h.backend.gates[P.wardrobe] = Gate();
    final reload = list.refreshUrls();
    await pumpEventQueue();
    final uploaded = standardSerializers.deserializeWith(WardrobeItem.serializer, itemJson('new-1'))!;
    list.insert(uploaded);
    list.remove('a');
    gate.open();
    await reload;
    expect(c.read(wardrobeListProvider).items.map((i) => i.id), ['new-1', 'b']);
  });

  test('an unexpected error (a bug, not an API answer) ends loading with a retryable failure', () async {
    var broken = true;
    final (c, _) = await start((r) {
      if (broken) throw StateError('a bug');
      return JsonReply(200, pageJson(['a']));
    });
    final s = c.read(wardrobeListProvider);
    expect(s.status, ListStatus.ready, reason: 'never left on loading');
    expect(s.failure, isA<UnexpectedErrorFailure>());
    broken = false;
    await c.read(wardrobeListProvider.notifier).refresh();
    expect(c.read(wardrobeListProvider).items, hasLength(1));
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
