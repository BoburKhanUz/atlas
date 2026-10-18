// Real-backend integration: changed legal texts are accepted again from the
// app. Skipped unless ATLAS_IT_BASE_URL and ATLAS_IT_PSQL are set (a local,
// disposable backend only — see backend_session_test.dart): the test marks
// the user's consent as older than the backend's minimum in that database.
import 'dart:io';

import 'package:atlas_mobile/core/network/api_client.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/features/legal/data/legal_repository.dart';
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
}
