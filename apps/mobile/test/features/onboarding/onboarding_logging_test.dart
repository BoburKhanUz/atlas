// Onboarding answers and profile data are never logged — on success, on
// every failure path, and in object descriptions.
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/onboarding/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import 'onboarding_flow_test.dart' show controllerOf, patchOkJson, profileJson, profilePath, start;

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

  // The chosen answers (wire values and labels) must never appear.
  const chosenStyle = StyleOption.bohemian;
  const chosenColor = ColorOption.burgundy;
  const chosenGender = GenderOption.female;
  const chosenFit = FitOption.oversized;
  final secrets = [
    chosenStyle.wire,
    chosenStyle.label,
    chosenColor.wire,
    chosenColor.label,
    chosenGender.wire,
    chosenGender.label,
    chosenFit.wire,
    chosenFit.label,
    'a@test.local',
  ];

  void expectClean() {
    final text = lines.join('\n');
    expect(lines, isNotEmpty, reason: 'logging was active');
    for (final s in secrets) {
      expect(text, isNot(contains(s)), reason: 'log must not contain "$s"');
    }
  }

  Future<void> run(FakeReply patchReply) async {
    final h = SessionHarness(stored: pair(1));
    h.backend.script(profilePath, [JsonReply(200, profileJson())]);
    final c = await start(h);
    h.backend.handlers[profilePath] = (r) => patchReply;
    final ctl = controllerOf(c)
      ..next()
      ..update((a) => a.togglePreferredStyle(chosenStyle))
      ..next()
      ..update((a) => a.withGender(chosenGender).withFit(chosenFit))
      ..next()
      ..update((a) => a.toggleFavoriteColor(chosenColor))
      ..next();
    await ctl.finish();
    // Describing the state must not leak either.
    lines.add(c.read(onboardingControllerProvider).answers.toString());
    lines.add(c.read(onboardingGateProvider).status.toString());
  }

  test('successful save: no answers in the log', () async {
    await run(JsonReply(200, patchOkJson()));
    expectClean();
  });

  test('validation failure (server echoes field paths): no answers in the log', () async {
    await run(
      JsonReply(
        400,
        errorBody(
          'VALIDATION_ERROR',
          details: [
            {'path': 'preferences.preferredStyles.0', 'message': 'bohemian noto‘g‘ri'},
          ],
        ),
      ),
    );
    expectClean();
  });

  test('network failure: no answers in the log', () async {
    await run(TransportFailure(DioExceptionType.connectionError));
    expectClean();
  });
}
