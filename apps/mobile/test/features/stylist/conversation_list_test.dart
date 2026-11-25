import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/stylist/presentation/conversation_list_controller.dart';
import 'package:atlas_mobile/features/stylist/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  test('an unexpected error ends loading with a retryable failure; refresh recovers', () async {
    final h = SessionHarness(stored: pair(1));
    var broken = true;
    h.backend.handlers[P.conversations] = (r) {
      if (broken) throw StateError('a bug');
      return JsonReply(200, {'conversations': <Object>[]});
    };
    final c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    await h.session.restore();
    c.listen(conversationListProvider, (_, _) {});
    for (var i = 0; i < 50 && c.read(conversationListProvider).status == ConversationListStatus.loading; i++) {
      await pumpEventQueue();
    }
    final s = c.read(conversationListProvider);
    expect(s.status, ConversationListStatus.failed, reason: 'never left on loading');
    expect(s.failure, isA<UnexpectedErrorFailure>());
    broken = false;
    await c.read(conversationListProvider.notifier).refresh();
    expect(c.read(conversationListProvider).status, ConversationListStatus.ready);
  });
}
