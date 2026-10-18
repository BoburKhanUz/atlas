// Real-backend integration: changed legal texts are accepted again from the
// app. Skipped unless ATLAS_IT_BASE_URL and ATLAS_IT_PSQL are set (a local,
// disposable backend only — see backend_session_test.dart): the test marks
// the user's consent as older than the backend's minimum in that database.
import 'dart:io';

import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/legal/consent_gate.dart';
import 'package:atlas_mobile/features/legal/data/legal_repository.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/data/profile_repository.dart';
import 'package:atlas_mobile/features/onboarding/onboarding_gate.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart' show FakeNetwork;
import 'backend_session_test.dart' show Device;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
final _psql = Platform.environment['ATLAS_IT_PSQL'];

Future<void> _sql(String query) async {
  final parts = _psql!.split(' ');
  expect(parts[parts.indexOf('-d') + 1], startsWith('itest_'), reason: 'only a disposable test database');
  final run = await Process.run(parts.first, [...parts.skip(1), '-v', 'ON_ERROR_STOP=1', '-c', query]);
  expect(run.exitCode, 0, reason: '${run.stderr}');
}

Future<void> _until(bool Function() done) async {
  for (var i = 0; i < 200 && !done(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  expect(done(), isTrue);
}

void main() {
  test(
    'changed legal texts: the app is told, every request is refused, accepting from the app lets it work again',
    () async {
      final d = Device();
      await d.session.restore();
      await d.register(
        email: 'mobile-consent-${DateTime.now().microsecondsSinceEpoch}@test.local',
        password: 'it-password-123',
      );
      final refusals = ConsentRefusals();
      addTearDown(refusals.dispose);
      final client = AtlasApiClient(dio: d.client.dio, network: FakeNetwork(), consentRefusals: refusals);
      final legal = LegalRepository(client);
      expect(await legal.consentRequired(), isFalse);

      await _sql('UPDATE "LegalConsent" SET "version" = \'2020-01-01.1\' WHERE "userId" = \'${d.stored!.user.id}\'');
      expect(await legal.consentRequired(), isTrue);
      final reported = refusals.stream.first;
      await expectLater(
        client.call((api) => api.getWardrobeApi().listWardrobeItems()),
        throwsA(isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.consentRequired)),
      );
      await reported;

      await legal.accept(version: (await legal.get()).version);
      expect(await legal.consentRequired(), isFalse);
      final items = await client.call((api) => api.getWardrobeApi().listWardrobeItems());
      expect(items.items, isEmpty);
    },
    skip: _base == null || _psql == null ? 'set ATLAS_IT_BASE_URL and ATLAS_IT_PSQL to run' : null,
  );

  test(
    'texts changed before onboarding was done: onboarding is decided after they are accepted, not skipped',
    () async {
      final d = Device();
      await d.session.restore();
      await d.register(
        email: 'mobile-consent-onboarding-${DateTime.now().microsecondsSinceEpoch}@test.local',
        password: 'it-password-123',
      );
      await _sql('UPDATE "LegalConsent" SET "version" = \'2020-01-01.1\' WHERE "userId" = \'${d.stored!.user.id}\'');
      final refusals = ConsentRefusals();
      addTearDown(refusals.dispose);
      final client = AtlasApiClient(dio: d.client.dio, network: FakeNetwork(), consentRefusals: refusals);
      final legal = LegalRepository(client);
      final consent = ConsentGate(
        session: d.session,
        consentRequired: legal.consentRequired,
        refusals: refusals.stream,
      );
      addTearDown(consent.dispose);
      final onboarding = OnboardingGate(
        session: d.session,
        consent: consent,
        markers: OnboardingMarkerStore(d.kv),
        hasStylePreferences: ProfileRepository(client).hasStylePreferences,
      );
      addTearDown(onboarding.dispose);
      await _until(() => consent.status == ConsentStatus.required);
      expect(onboarding.status, OnboardingStatus.checking);

      await legal.accept(version: (await legal.get()).version);
      consent.markAccepted();
      await _until(() => onboarding.status != OnboardingStatus.checking);
      expect(onboarding.status, OnboardingStatus.required, reason: 'a new account has no preferences yet');
    },
    skip: _base == null || _psql == null ? 'set ATLAS_IT_BASE_URL and ATLAS_IT_PSQL to run' : null,
  );
}
