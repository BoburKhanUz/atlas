import 'dart:async';

import 'package:atlas_mobile/core/time/refresh_throttle.dart';
import 'package:atlas_mobile/features/outfits/presentation/outfit_list_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'outfit_fixtures.dart';

void main() {
  test(
    'expired images reported by many rows reload the outfits once; a later report waits, it is not dropped',
    () async {
      final h = SessionHarness(stored: pair(1));
      h.backend.handlers[P.outfits] = (_) => JsonReply(200, listJson([summaryJson('o1'), summaryJson('o2')]));
      var now = Duration.zero;
      final waits = <(Duration, Completer<void>)>[];
      final c = ProviderContainer(
        overrides: [
          ...appOverrides(h),
          monotonicClockProvider.overrideWithValue(() => now),
          delayProvider.overrideWithValue((d) {
            final done = Completer<void>();
            waits.add((d, done));
            return done.future;
          }),
        ],
      );
      addTearDown(c.dispose);
      await h.session.restore();
      c.listen(outfitListProvider(true), (_, _) {});
      Future<void> settle() async {
        for (var i = 0; i < 50 && c.read(outfitListProvider(true)).status != OutfitListStatus.ready; i++) {
          await pumpEventQueue();
        }
      }

      await settle();
      final list = c.read(outfitListProvider(true).notifier);
      await Future.wait([list.refreshImages(), list.refreshImages(), list.refreshImages()]);
      expect(h.backend.calls(P.outfits), 2, reason: 'first load + one reload');
      now += const Duration(seconds: 5);
      await list.refreshImages(); // the fresh URL looks expired too (a clock far off)
      expect(h.backend.calls(P.outfits), 2, reason: 'no request loop');
      expect(waits.single.$1, const Duration(seconds: 25));
      now += const Duration(seconds: 25);
      waits.single.$2.complete();
      await pumpEventQueue();
      await settle();
      expect(h.backend.calls(P.outfits), 3, reason: 'the report is done when the interval is over');
    },
  );
}
