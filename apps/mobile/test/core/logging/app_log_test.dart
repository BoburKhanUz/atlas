import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // A fake JWT ({"alg":"HS256"}.{"sub":"u1","sid":"s1"}."signature-value"),
  // assembled at runtime so no token-shaped literal exists in the source.
  final jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1MSIsInNpZCI6InMxIn0', 'c2lnbmF0dXJlLXZhbHVl'].join('.');
  const refresh = 'kq3J9xZ0PzR8w-T1fYb2_HcLmN4vQs7uA6eDgK5iOp0';

  group('redact', () {
    test('bearer tokens', () {
      final out = AppLog.redact('Authorization: Bearer $refresh');
      expect(out, isNot(contains(refresh)));
      expect(out, contains('Bearer [REDACTED]'));
    });

    test('token, password and idempotency fields in JSON and maps', () {
      final input =
          '{"accessToken":"$jwt","refreshToken":"$refresh","password":"hunter22","email":"a@test.local"} '
          'refresh_token=$refresh Idempotency-Key: upload-123456789';
      final out = AppLog.redact(input);
      for (final secret in [jwt, refresh, 'hunter22', 'upload-123456789']) {
        expect(out, isNot(contains(secret)), reason: secret);
      }
      expect(out, contains('a@test.local')); // non-secret fields stay readable
    });

    test('cookies and signed media URLs', () {
      final out = AppLog.redact(
        'cookie: atlas_at=$jwt; atlas_rt=$refresh  GET /api/v1/media/users/u1/a_display.webp?exp=1790000000&sig=abcDEF123_-',
      );
      expect(out, isNot(contains(jwt)));
      expect(out, isNot(contains(refresh)));
      expect(out, isNot(contains('abcDEF123_-')));
      expect(out, contains('exp=1790000000'));
    });

    test('bare JWTs anywhere', () {
      expect(AppLog.redact('token was $jwt end'), 'token was [REDACTED_JWT] end');
    });

    test('plain text is unchanged', () {
      const msg = 'GET /api/v1/wardrobe/items → 200 in 84 ms (requestId 7f1c)';
      expect(AppLog.redact(msg), msg);
    });
  });

  group('emission', () {
    final lines = <String>[];
    setUp(() {
      lines.clear();
      AppLog.sink = lines.add;
    });
    tearDown(() => AppLog.policy = LogPolicy.verbose);

    test('messages are redacted before they reach the sink', () {
      AppLog.policy = LogPolicy.verbose;
      AppLog.info('refreshed with Bearer $refresh');
      expect(lines.single, isNot(contains(refresh)));
    });

    test('nothing is emitted with LogPolicy.off (production, release builds)', () {
      AppLog.policy = LogPolicy.off;
      AppLog.error('boom', StateError('x'));
      AppLog.info('hello');
      expect(lines, isEmpty);
    });

    test('LogPolicy.warnings emits only warnings and errors', () {
      AppLog.policy = LogPolicy.warnings;
      AppLog.debug('d');
      AppLog.info('i');
      AppLog.warn('w');
      AppLog.error('e');
      expect(lines, ['[atlas][W] w', '[atlas][E] e']);
    });

    test('errors log only their type, never their message', () {
      AppLog.policy = LogPolicy.verbose;
      AppLog.error('request failed', StateError('secret $refresh'));
      expect(lines.single, contains('StateError'));
      expect(lines.single, isNot(contains(refresh)));
    });
  });
}
