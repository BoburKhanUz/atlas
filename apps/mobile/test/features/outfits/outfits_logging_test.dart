// Phase 3.7 paths never log a coordinate (raw or rounded), a signed URL or
// signature, a token, or the weather/outfit content.
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/outfits/data/outfits_repository.dart';
import 'package:atlas_mobile/features/outfits/presentation/generate_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/data/device_locator.dart';
import 'package:atlas_mobile/features/weather/data/location.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'outfit_fixtures.dart';

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

  test('weather + generate + save (lost, checked, unknown) + feedback failure: nothing sensitive logged', () async {
    final h = SessionHarness(stored: pair(1));
    h.locator
      ..current = LocationAccess.granted
      ..result = Located(RoundedLocation.round(41.3112, 69.2798)!);
    h.backend.script(P.weather, [JsonReply(200, weatherJson(temperature: 23)), JsonReply(500, errorBody('INTERNAL'))]);
    h.backend.script(P.generate, [JsonReply(200, generateJson(weatherUsed: weatherUsedJson(temperature: 23)))]);
    var posts = 0;
    h.backend.handlers[P.outfits] = (r) => r.method == 'POST'
        ? (posts++ == 0 ? TransportFailure(DioExceptionType.receiveTimeout) : JsonReply(201, saveResponseJson('o1')))
        : JsonReply(200, listJson(const []), headers: {'Date': httpDate(DateTime.utc(2026, 10, 5, 12))});
    h.backend.handlers['${P.outfits}/o1/feedback'] = (_) => JsonReply(400, errorBody('VALIDATION_ERROR'));
    final c = ProviderContainer(overrides: appOverrides(h));
    addTearDown(c.dispose);
    await h.session.restore();
    c.listen(generateControllerProvider, (_, _) {});
    c.listen(weatherControllerProvider, (_, _) {});
    final weather = c.read(weatherControllerProvider.notifier);
    await weather.refreshIfStale();
    await weather.refresh(); // 500
    await weather.chooseCity(Cities.byId('nukus')!);
    final gen = c.read(generateControllerProvider.notifier);
    await gen.generate();
    await gen.save('t1'); // lost → check → unknown
    await gen.saveAgain('t1');
    await gen.feedback('t1', OutfitFeedback.liked); // 400

    expect(c.read(generateControllerProvider).candidate('t1').save, SaveStatus.saved);
    final text = lines.join('\n');
    expect(lines, isNotEmpty);
    for (final secret in [
      '41.31', '69.28', '41.3112', '42.46', '59.6', // coordinates (rounded, raw, city)
      sigOf('top1'), 'sig=', 'exp=', // signed URLs
      access(1), refresh(1),
      '23°', 'Ob-havoga mos', 'Bulutli', // weather / outfit content
    ]) {
      expect(text, isNot(contains(secret)), reason: 'leaked: $secret');
    }
  });
}
