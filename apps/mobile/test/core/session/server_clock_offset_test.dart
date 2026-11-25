import 'dart:io' show HttpDate;

import 'package:atlas_mobile/core/session/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  test('the server clock offset measured at sign-in reaches the images (provider follows the session)', () async {
    final h = SessionHarness();
    // The server's clock is one hour behind the device's (the harness clock).
    final serverNow = h.wall.toUtc().subtract(const Duration(hours: 1));
    h.backend.script(P.login, [
      JsonReply(200, pairJson(1), headers: {'date': HttpDate.format(serverNow)}),
    ]);
    final c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    await h.session.restore();
    c.listen(serverClockOffsetProvider, (_, _) {});
    expect(c.read(serverClockOffsetProvider), Duration.zero);
    await h.session.login(email: 'a@test.local', password: 'pw');
    final offset = c.read(serverClockOffsetProvider);
    // HTTP dates have whole seconds.
    expect(offset.inSeconds, inInclusiveRange(-3601, -3599));
  });
}
