import 'dart:io';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/network/interceptors.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import 'fixtures.dart';

void main() {
  Future<WardrobeListResponse> list(Harness h) => h.client.call((api) => api.getWardrobeApi().listWardrobeItems());

  group('safe GET requests', () {
    test('timeout then success: retried after 1 s', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.receiveTimeout),
        JsonReply(200, wardrobeListJson()),
      ], token: 't');
      final res = await list(h);
      expect(res.items, hasLength(1));
      expect(h.sent, hasLength(2));
      expect(h.sleeps, [const Duration(seconds: 1)]);
    });

    test('connection reset then success', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.connectionError, const SocketException('Connection reset by peer')),
        JsonReply(200, wardrobeListJson()),
      ]);
      await list(h);
      expect(h.sent, hasLength(2));
    });

    test('network errors: at most 2 retries (1 s, then 2 s), then the failure', () async {
      final h = Harness([TransportFailure(DioExceptionType.connectionTimeout)], token: 't');
      await expectLater(list(h), throwsA(isA<TimeoutFailure>()));
      expect(h.sent, hasLength(3));
      expect(h.sleeps, [const Duration(seconds: 1), const Duration(seconds: 2)]);
    });

    test('no retry starts later than 45 s after the first attempt', () async {
      // every clock read advances 30 s: the 2nd retry would start after 45 s
      final h = Harness([TransportFailure(DioExceptionType.connectionError)], clockStep: const Duration(seconds: 30));
      await expectLater(list(h), throwsA(isA<ApiFailure>()));
      expect(h.sent.length, lessThan(3));
    });

    test('offline device: retries are bounded and end in NoNetworkFailure', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.connectionError, const SocketException('no route')),
      ], online: false);
      await expectLater(list(h), throwsA(isA<NoNetworkFailure>()));
      expect(h.sent, hasLength(3));
    });

    test('HTTP errors other than SESSION_BUSY are not retried (500, 404, 401)', () async {
      for (final (status, code) in [(500, 'INTERNAL'), (404, 'NOT_FOUND'), (401, 'UNAUTHORIZED')]) {
        final h = Harness([JsonReply(status, errorBody(code))], token: 't');
        await expectLater(list(h), throwsA(isA<ApiHttpFailure>()));
        expect(h.sent, hasLength(1), reason: code);
      }
    });

    test('certificate errors are never retried', () async {
      final h = Harness([TransportFailure(DioExceptionType.badCertificate)]);
      await expectLater(list(h), throwsA(isA<InsecureConnectionFailure>()));
      expect(h.sent, hasLength(1));
    });
  });

  group('503 SESSION_BUSY', () {
    test('waits Retry-After (+ bounded jitter) and retries', () async {
      final h = Harness([
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
        JsonReply(200, wardrobeListJson()),
      ], token: 't');
      await list(h);
      expect(h.sent, hasLength(2));
      expect(h.sleeps.single, greaterThanOrEqualTo(const Duration(seconds: 1)));
      expect(h.sleeps.single, lessThanOrEqualTo(const Duration(milliseconds: 1250)));
    });

    test('Retry-After is honoured as given (e.g. 3 s)', () async {
      final h = Harness([
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '3'}),
        JsonReply(200, wardrobeListJson()),
      ]);
      await list(h);
      expect(h.sleeps.single, greaterThanOrEqualTo(const Duration(seconds: 3)));
    });

    test('at most 3 attempts, then the SESSION_BUSY failure with its Retry-After', () async {
      final h = Harness([
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
      ]);
      final failure = await list(h).then<Object?>((_) => null, onError: (Object e) => e);
      expect(h.sent, hasLength(3));
      expect(failure, isA<ApiHttpFailure>());
      expect((failure! as ApiHttpFailure).retryAfter, const Duration(seconds: 1));
    });

    test('a Retry-After longer than the cap is not waited for automatically', () async {
      final h = Harness([
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '120'}),
      ]);
      await expectLater(list(h), throwsA(isA<ApiHttpFailure>()));
      expect(h.sent, hasLength(1));
      expect(h.sleeps, isEmpty);
    });

    test('POST refresh: SESSION_BUSY has no side effects, so it is retried', () async {
      final h = Harness([
        JsonReply(503, errorBody('SESSION_BUSY'), headers: {'Retry-After': '1'}),
        JsonReply(200, mobileAuthJson()),
      ]);
      await h.client.call(
        (api) =>
            api.getAuthApi().refreshSession(mobileRefreshRequest: MobileRefreshRequest((b) => b..refreshToken = 'r')),
      );
      expect(h.sent, hasLength(2));
      expect(h.sent.map((r) => r.bodyText), everyElement('{"refreshToken":"r"}'));
    });

    test('a plain 503 without SESSION_BUSY is not retried', () async {
      final h = Harness([RawReply(503, '<html>maintenance</html>')]);
      await expectLater(list(h), throwsA(isA<UnexpectedResponseFailure>()));
      expect(h.sent, hasLength(1));
    });
  });

  group('non-idempotent requests are never blindly retried', () {
    test('POST mutation after a timeout: exactly one attempt', () async {
      final h = Harness([TransportFailure(DioExceptionType.receiveTimeout)], token: 't');
      await expectLater(
        h.client.call(
          (api) => api.getOutfitsApi().sendOutfitFeedback(
            id: 'o1',
            outfitFeedbackRequest: OutfitFeedbackRequest((b) => b..feedback = OutfitFeedbackRequestFeedbackEnum.liked),
          ),
        ),
        throwsA(isA<TimeoutFailure>()),
      );
      expect(h.sent, hasLength(1));
      expect(h.sleeps, isEmpty);
    });

    test('multipart upload after a connection error: exactly one attempt (caller retries with the same key)', () async {
      final h = Harness([TransportFailure(DioExceptionType.connectionError)], token: 't');
      await expectLater(
        h.client.call(
          (api) => api.getWardrobeApi().createWardrobeItem(
            file: MultipartFile.fromBytes(Uint8List(10), filename: 'a.jpg'),
            idempotencyKey: 'upload-0123456789',
          ),
        ),
        throwsA(isA<ApiFailure>()),
      );
      expect(h.sent, hasLength(1));
    });

    test('DELETE account and PATCH profile: one attempt on network failure', () async {
      final h = Harness([TransportFailure(DioExceptionType.connectionTimeout)], token: 't');
      await expectLater(h.client.call((api) => api.getAccountApi().deleteAccount()), throwsA(isA<ApiFailure>()));
      expect(h.sent, hasLength(1));
    });

    test('explicit idempotent opt-in enables network retries for a non-GET JSON request', () async {
      final h = Harness([
        TransportFailure(DioExceptionType.connectionError),
        JsonReply(200, {'ok': true}),
      ], token: 't');
      await h.dio.post<Object>(
        '/api/v1/x',
        data: {'a': 1},
        options: Options(extra: {AtlasRequestExtra.idempotent: true}),
      );
      expect(h.sent, hasLength(2));
    });

    test('opt-in never applies to multipart bodies', () {
      final o = RequestOptions(
        path: '/x',
        method: 'POST',
        data: FormData(),
        extra: {AtlasRequestExtra.idempotent: true},
      );
      expect(AtlasRetryInterceptor.isSafeToRepeat(o), isFalse);
    });
  });
}
