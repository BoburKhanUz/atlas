import 'dart:io';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/network/connectivity.dart';
import 'package:atlas_mobile/core/network/media_url.dart';
import 'package:atlas_mobile/core/network/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import 'fixtures.dart';

void main() {
  group('connectivity: three distinct situations', () {
    test('1) device has no network', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.connectionError, const SocketException('x')),
      ], online: false);
      await expectLater(h.client.call((api) => api.getServiceApi().getHealth()), throwsA(isA<NoNetworkFailure>()));
    });

    test('2) network exists but the API is unreachable (Wi-Fi up ≠ API up)', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.connectionError, const SocketException('refused')),
      ], online: true);
      await expectLater(h.client.call((api) => api.getServiceApi().getHealth()), throwsA(isA<ApiUnreachableFailure>()));
      expect(h.reachability.reachable, isFalse);
    });

    test('3) the API answered with an HTTP error: reachable, typed HTTP failure', () async {
      final h = Harness([JsonReply(500, errorBody('INTERNAL'))]);
      h.reachability.report(reachable: false);
      await expectLater(h.client.call((api) => api.getServiceApi().getHealth()), throwsA(isA<ApiHttpFailure>()));
      expect(h.reachability.reachable, isTrue);
    });

    test('a successful response marks the API reachable again', () async {
      final h = Harness([JsonReply(200, healthJson())]);
      h.reachability.report(reachable: false);
      await h.client.call((api) => api.getServiceApi().getHealth());
      expect(h.reachability.reachable, isTrue);
    });

    test('combineStatus', () {
      expect(combineStatus(deviceOnline: false, apiReachable: true), NetworkStatus.noNetwork);
      expect(combineStatus(deviceOnline: false, apiReachable: false), NetworkStatus.noNetwork);
      expect(combineStatus(deviceOnline: true, apiReachable: false), NetworkStatus.apiUnreachable);
      expect(combineStatus(deviceOnline: true, apiReachable: true), NetworkStatus.online);
    });

    test('networkStatusProvider follows device changes and API reachability', () async {
      final network = FakeNetwork();
      final container = ProviderContainer(
        overrides: [
          environmentConfigProvider.overrideWithValue(
            AtlasEnvironmentConfig.fromValues(environment: 'development', apiBaseUrl: 'http://api.test'),
          ),
          deviceNetworkProvider.overrideWithValue(network),
        ],
      );
      addTearDown(container.dispose);
      final seen = <NetworkStatus>[];
      container.listen(networkStatusProvider, (_, next) {
        if (next.hasValue) seen.add(next.value!);
      }, fireImmediately: true);
      await Future<void>.delayed(Duration.zero);
      network.set(false);
      await Future<void>.delayed(Duration.zero);
      network.set(true);
      await Future<void>.delayed(Duration.zero);
      container.read(apiReachabilityProvider).report(reachable: false);
      await Future<void>.delayed(Duration.zero);
      expect(seen, [NetworkStatus.online, NetworkStatus.noNetwork, NetworkStatus.online, NetworkStatus.apiUnreachable]);
    });
  });

  group('security: logs never contain credentials', () {
    final lines = <String>[];
    setUp(() {
      lines.clear();
      AppLog.sink = lines.add;
      AppLog.policy = LogPolicy.verbose;
    });

    // Token-shaped values assembled at runtime (no literal tokens in source).
    final access = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1MSIsInNpZCI6InMxIn0', 'QUNDRVNTLVNJRw'].join('.');
    const refresh = 'R3fr3sh-Tok3n_value-0123456789abcdef';

    test('a full authenticated round trip logs method, path and status only', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: access);
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems(headers: {'Cookie': 'atlas_rt=$refresh'}));
      final all = lines.join('\n');
      expect(all, contains('GET /api/v1/wardrobe/items'));
      for (final secret in [access, refresh, 'Bearer', 'atlas_rt', 'Cookie', 'sig=', 'exp=']) {
        expect(all, isNot(contains(secret)), reason: secret);
      }
    });

    test('refresh/login bodies (tokens, passwords) never reach the log', () async {
      final h = Harness([JsonReply(200, mobileAuthJson()..['refreshToken'] = refresh)]);
      await h.client.call(
        (api) => api.getAuthApi().refreshSession(
          mobileRefreshRequest: MobileRefreshRequest((b) => b..refreshToken = refresh),
        ),
      );
      await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'super-secret-pw',
          ),
        ),
      );
      final all = lines.join('\n');
      for (final secret in [refresh, 'super-secret-pw', 'acc.tok.en']) {
        expect(all, isNot(contains(secret)), reason: secret);
      }
    });

    test('signed media URLs: the query (exp/sig) is never logged', () async {
      final h = Harness([RawReply(200, 'img', contentType: 'image/webp')]);
      await h.dio.get<Object>(
        '/api/v1/media/users/u1/a_display.webp',
        queryParameters: {'exp': '1790000000', 'sig': 'S1GNATURE'},
      );
      final all = lines.join('\n');
      expect(all, contains('/api/v1/media/users/u1/a_display.webp'));
      expect(all, isNot(contains('S1GNATURE')));
    });

    test('failures are logged by code, without bodies or URLs', () async {
      final h = Harness([JsonReply(401, errorBody('SESSION_REVOKED', error: 'secret $refresh'))]);
      await expectLater(
        h.client.call((api) => api.getWardrobeApi().listWardrobeItems()),
        throwsA(isA<ApiHttpFailure>()),
      );
      final all = lines.join('\n');
      expect(all, contains('SESSION_REVOKED'));
      expect(all, isNot(contains(refresh)));
    });

    test('production logs nothing at all', () async {
      AppLog.policy = AtlasEnvironmentConfig.fromValues(
        environment: 'production',
        apiBaseUrl: 'https://api.example.com',
      ).logPolicy;
      final h = Harness([JsonReply(200, wardrobeListJson())], token: access);
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      expect(lines, isEmpty);
    });

    test('a failure toString never contains server-provided text', () {
      const f = ApiHttpFailure(statusCode: 401, code: ApiErrorCode.sessionRevoked, serverMessage: 'secret-server-text');
      expect(f.toString(), isNot(contains('secret-server-text')));
    });
  });

  group('signed media URLs', () {
    final now = DateTime.utc(2026, 10, 5, 10);
    test('usable until 60 s before expiry', () {
      expect(SignedMediaUrl.isUsable(now.add(const Duration(minutes: 5)), now: now), isTrue);
      expect(SignedMediaUrl.isUsable(now.add(const Duration(seconds: 59)), now: now), isFalse);
      expect(SignedMediaUrl.isUsable(now.subtract(const Duration(seconds: 1)), now: now), isFalse);
    });
  });
}
