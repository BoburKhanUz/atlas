// Real-backend integration: the password reset requested from the app (its
// e-mailed link completed the way the web page does it) and crash reports.
// Skipped unless ATLAS_IT_BASE_URL is set (a local, disposable backend only —
// see backend_session_test.dart). The reset round trip also needs
// ATLAS_IT_MAIL_OUTBOX: the backend's MAIL_OUTBOX_DIR with MAIL_TRANSPORT=outbox.
import 'dart:convert';
import 'dart:io';

import 'package:atlas_api/atlas_api.dart'
    show ClientErrorReport, ClientErrorReportKindEnum, ClientErrorReportPlatformEnum;
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/crash_reporter.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/auth/data/password_reset_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import 'backend_session_test.dart' show Device, rawPost, waitForAccessExpiry;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];
final _outbox = Platform.environment['ATLAS_IT_MAIL_OUTBOX'];
const _password = 'it-password-123';
const _newPassword = 'it-new-password-456';

String _email(String label) => 'mobile-$label-${DateTime.now().microsecondsSinceEpoch}@test.local';

/// The newest reset token e-mailed to [email] (the backend writes it in the background).
Future<String> _tokenFor(String email) async {
  for (var i = 0; i < 100; i++) {
    final mails = [
      for (final f in Directory(_outbox!).listSync().whereType<File>())
        if (jsonDecode(f.readAsStringSync())
            case {'to': final String to, 'text': final String text, 'createdAt': final String at} when to == email)
          (at, text),
    ]..sort((a, b) => a.$1.compareTo(b.$1));
    if (mails.isNotEmpty) {
      final link = RegExp(r'https?://\S+').firstMatch(mails.last.$2)![0]!;
      return Uri.parse(link).queryParameters['token']!;
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  throw StateError('no reset e-mail for $email');
}

void main() {
  group(
    'real backend: password reset and crash reports',
    skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null,
    () {
      test(
        'forgot: the same answer for an account and an unknown address; a 4th request for one address is RATE_LIMITED',
        () async {
          final d = Device();
          await d.session.restore();
          final email = _email('reset');
          await d.register(email: email, password: _password);
          final repo = PasswordResetRepository(d.client);
          await repo.requestLink(email);
          await repo.requestLink(_email('nobody'));
          final other = _email('limit');
          for (var i = 0; i < 3; i++) {
            await repo.requestLink(other);
          }
          await expectLater(
            repo.requestLink(other),
            throwsA(isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.rateLimited)),
          );
        },
      );

      test(
        'round trip: link requested in the app, new password set by the link, the phone signed out, sign-in with the new one',
        skip: _outbox == null ? 'set ATLAS_IT_MAIL_OUTBOX to the backend MAIL_OUTBOX_DIR' : null,
        () async {
          final d = Device();
          await d.session.restore();
          final email = _email('roundtrip');
          await d.register(email: email, password: _password);
          await PasswordResetRepository(d.client).requestLink(email);
          final token = await _tokenFor(email);

          final (status, _) = await rawPost('/api/v1/auth/password/reset', {
            'token': token,
            'password': _newPassword,
          }, mobile: false);
          expect(status, 200);
          final (again, body) = await rawPost('/api/v1/auth/password/reset', {
            'token': token,
            'password': 'it-third-password-789',
          }, mobile: false);
          expect((again, body['code']), (400, 'RESET_TOKEN_INVALID'));

          await waitForAccessExpiry();
          expect(await d.me(), isA<SessionEndedFailure>());
          expect(d.session.state, const SessionExpired(SignedOutReason.revoked));
          expect(d.kv.values, isEmpty);

          final fresh = Device();
          await fresh.session.restore();
          await expectLater(fresh.session.login(email: email, password: _password), throwsA(isA<ApiHttpFailure>()));
          await fresh.session.login(email: email, password: _newPassword);
          expect(fresh.session.state, isA<Authenticated>());
        },
      );

      test('a crash report reaches the server log endpoint', () async {
        final send = httpErrorReportSender(
          AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: _base!),
        );
        Object? failure;
        final sent = <ClientErrorReport>[];
        final reporter = CrashReporter(
          send: (reports) async {
            try {
              await send(reports);
              sent.addAll(reports);
            } on Object catch (e) {
              failure = e;
              rethrow;
            }
          },
          appVersion: '0.1.0+1',
          platform: ClientErrorReportPlatformEnum.android,
          osVersion: 'it',
        )..currentRoute = () => '/wardrobe';
        reporter.record(
          StateError('mobile integration test report'),
          StackTrace.current,
          kind: ClientErrorReportKindEnum.dart,
        );
        await reporter.flush();
        expect(failure, isNull);
        expect(sent, hasLength(1));
      });
    },
  );
}
