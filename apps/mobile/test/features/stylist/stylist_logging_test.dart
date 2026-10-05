// The stylist never logs message text, answers, weather values, tokens or
// conversation ids.
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/stylist/providers.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../outfits/outfit_fixtures.dart' show weatherJson;
import 'stylist_fixtures.dart';

void main() {
  final lines = <String>[];
  late void Function(String) sink;
  late LogPolicy policy;
  setUp(() {
    lines.clear();
    sink = AppLog.sink;
    policy = AppLog.policy;
    AppLog.sink = lines.add;
    AppLog.policy = LogPolicy.verbose;
  });
  tearDown(() {
    AppLog.sink = sink;
    AppLog.policy = policy;
  });

  test('send / lost answer / refresh / 4xx / switched id: nothing sensitive logged', () async {
    final h = SessionHarness(stored: pair(1));
    h.backend.script(P.weather, [JsonReply(200, weatherJson(temperature: 31.7, fetchedAt: DateTime.now().toUtc()))]);
    h.backend.script(P.chat, [
      JsonReply(200, chatJson('conv-secret-1', answer: 'Javob-matni-XYZ')),
      TransportFailure(DioExceptionType.receiveTimeout),
      JsonReply(400, errorBody('VALIDATION_ERROR')),
      JsonReply(200, chatJson('conv-secret-2', answer: 'Ikkinchi-javob-QRS')),
    ]);
    h.backend.handlers['${P.conversations}/conv-secret-1'] = (_) =>
        JsonReply(200, conversationJson('conv-secret-1', const [('user', 'Maxfiy-savol-ABC')]));
    final c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    await h.session.restore();
    await c.read(weatherControllerProvider.notifier).chooseCity(Cities.all.first);
    c.listen(chatControllerProvider(newChatKey), (_, _) {});
    final chat = c.read(chatControllerProvider(newChatKey).notifier);
    await chat.send('Maxfiy-savol-ABC', event: 'wedding');
    await chat.send('Ikkinchi-savol-DEF');
    await chat.refresh();
    await chat.send('Uchinchi-savol-GHI', confirmResend: true);
    await chat.send('Tortinchi-savol-JKL');

    final text = lines.join('\n');
    expect(lines, isNotEmpty);
    expect(text, contains('/stylist/conversations/[id]'), reason: 'paths are logged with the id redacted');
    for (final secret in [
      'Maxfiy-savol-ABC',
      'Ikkinchi-savol-DEF',
      'Uchinchi-savol-GHI',
      'Tortinchi-savol-JKL',
      'Javob-matni-XYZ',
      'Ikkinchi-javob-QRS',
      'conv-secret-1',
      'conv-secret-2',
      '31.7',
      '41.31',
      '69.28',
      'wedding',
      access(1),
      refresh(1),
    ]) {
      expect(text, isNot(contains(secret)), reason: 'leaked: $secret');
    }
  });
}
