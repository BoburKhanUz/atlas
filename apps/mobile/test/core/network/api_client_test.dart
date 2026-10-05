import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/network/auth_response_x.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import 'fixtures.dart';

void main() {
  group('base URL and contract headers', () {
    test('requests go to the configured origin with the contract path', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())]);
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems(limit: 20));
      expect(h.sent.single.uri.toString(), 'http://api.test/api/v1/wardrobe/items?limit=20');
      expect(h.sent.single.method, 'GET');
    });

    test('X-Atlas-Client: mobile on every request, public and authenticated', () async {
      final h = Harness([JsonReply(200, wardrobeListJson()), JsonReply(200, healthJson())], token: 'access-1');
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      await h.client.call((api) => api.getServiceApi().getHealth());
      expect(h.sent.map((r) => r.header('X-Atlas-Client')), everyElement('mobile'));
    });

    test('a caller-supplied X-Atlas-Client value cannot override mobile mode', () async {
      final h = Harness([JsonReply(200, mobileAuthJson())]);
      await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'pw-123456',
          ),
          xAtlasClient: 'web',
        ),
      );
      expect(h.sent.single.header('X-Atlas-Client'), 'mobile');
    });

    test('JSON accept header is set', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())]);
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      expect(h.sent.single.header('Accept'), 'application/json');
    });

    test('redirects are not followed (Authorization must not be forwarded)', () {
      final h = Harness([JsonReply(200, {})]);
      expect(h.dio.options.followRedirects, isFalse);
    });
  });

  group('Authorization', () {
    test('Bearer access token on operations that require bearerAuth', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: 'access-xyz');
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      expect(h.sent.single.header('Authorization'), 'Bearer access-xyz');
    });

    test('never on public operations (login, refresh, health, media)', () async {
      final h = Harness([JsonReply(200, mobileAuthJson())], token: 'access-xyz');
      await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'pw-123456',
          ),
        ),
      );
      await h.client.call(
        (api) => api.getAuthApi().refreshSession(
          mobileRefreshRequest: MobileRefreshRequest((b) => b..refreshToken = 'refresh-1'),
        ),
      );
      expect(h.sent.map((r) => r.header('Authorization')), everyElement(isNull));
    });

    test('caller-supplied Authorization headers are dropped on public operations', () async {
      final h = Harness([JsonReply(200, healthJson())]);
      await h.client.call((api) => api.getServiceApi().getHealth(headers: {'Authorization': 'Bearer leaked'}));
      expect(h.sent.single.header('Authorization'), isNull);
    });

    test('signed out: no Authorization header and no cookie fallback', () async {
      final h = Harness([JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await expectLater(
        h.client.call((api) => api.getWardrobeApi().listWardrobeItems()),
        throwsA(isA<ApiHttpFailure>()),
      );
      expect(h.sent.single.header('Authorization'), isNull);
      expect(h.sent.single.header('Cookie'), isNull);
    });

    test('Cookie headers are always stripped (mobile uses Bearer only)', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: 't');
      await h.client.call(
        (api) => api.getWardrobeApi().listWardrobeItems(headers: {'Cookie': 'atlas_at=abc; atlas_rt=def'}),
      );
      expect(h.sent.single.header('Cookie'), isNull);
    });

    test('the generated cookie (apiKey) interceptor is not installed', () {
      final h = Harness([JsonReply(200, {})]);
      final names = h.dio.interceptors.map((i) => i.runtimeType.toString()).toList();
      expect(names.where((n) => n.startsWith('ApiKeyAuth') || n == 'BearerAuthInterceptor'), isEmpty);
      expect(names, containsAllInOrder(['AtlasClientHeadersInterceptor', 'AtlasBearerInterceptor']));
    });

    test('credentials are never sent as query parameters', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: 't');
      await expectLater(
        h.client.call<Object>(
          (api) => h.dio.get<Object>('/api/v1/wardrobe/items', queryParameters: {'access_token': 'x'}),
        ),
        throwsA(isA<StateError>()),
      );
      expect(h.sent, isEmpty);
    });

    test('the token is read per request (a refreshed token is used immediately)', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: 'old');
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      h.tokens.token = 'new';
      await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      expect(h.sent.map((r) => r.header('Authorization')), ['Bearer old', 'Bearer new']);
    });
  });

  group('multipart upload (POST /api/v1/wardrobe/items)', () {
    final jpeg = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, ...List.filled(64, 7), 0xFF, 0xD9]);

    Future<Harness> upload({String? key}) async {
      final h = Harness([JsonReply(201, wardrobeUploadJson())], token: 'access-1');
      await h.client.call(
        (api) => api.getWardrobeApi().createWardrobeItem(
          file: MultipartFile.fromBytes(jpeg, filename: 'shirt.jpg', contentType: DioMediaType('image', 'jpeg')),
          filename: 'shirt.jpg',
          idempotencyKey: key,
        ),
      );
      return h;
    }

    test('is sent as multipart/form-data with the binary file part', () async {
      final h = await upload(key: 'upload-0123456789');
      final r = h.sent.single;
      expect(r.method, 'POST');
      expect(r.header('content-type').toString(), startsWith('multipart/form-data; boundary='));
      final body = latin1.decode(r.body);
      final lower = body.toLowerCase();
      expect(lower, contains('content-disposition: form-data; name="file"; filename="shirt.jpg"'));
      expect(lower, contains('content-type: image/jpeg'));
      expect(lower, contains('content-disposition: form-data; name="filename"'));
      // the exact JPEG bytes are in the body (not a stringified value)
      final bodyBytes = r.body;
      final start = _indexOf(bodyBytes, jpeg);
      expect(start, greaterThan(0));
    });

    test('carries the Idempotency-Key header and Bearer auth', () async {
      final h = await upload(key: 'upload-0123456789');
      expect(h.sent.single.header('Idempotency-Key'), 'upload-0123456789');
      expect(h.sent.single.header('Authorization'), 'Bearer access-1');
    });

    test('the 201 body deserializes into the generated WardrobeUploadResponse', () async {
      final h = Harness([JsonReply(201, wardrobeUploadJson())], token: 't');
      final res = await h.client.call(
        (api) => api.getWardrobeApi().createWardrobeItem(file: MultipartFile.fromBytes(jpeg, filename: 'a.jpg')),
      );
      expect(res.item.id, 'item-1');
      expect(res.detection.category, 'shirt');
      expect(res.detection.mock, isTrue); // boolean const decodes as a real bool
    });
  });

  group('generated models', () {
    test('wardrobe list: required, nullable and nested fields', () async {
      final h = Harness([JsonReply(200, wardrobeListJson())], token: 't');
      final res = await h.client.call((api) => api.getWardrobeApi().listWardrobeItems());
      final item = res.items.single;
      expect(item.category, 'shirt');
      expect(item.fit, isNull); // nullable stays null
      expect(item.material, 'cotton');
      expect(item.colors.toList(), ['white']);
      expect(item.confidences['category'], 0.92);
      expect(item.primaryImage!.url, startsWith('http://api.test/api/v1/media/'));
      expect(item.primaryImage!.width, 1600);
      expect(item.primaryImage!.thumbnailUrl, isNotNull);
      expect(item.createdAt.isUtc, isTrue);
      expect(res.nextCursor, 'cursor-2');
    });

    test('mobile auth body: tokens and expiry instants', () async {
      final h = Harness([JsonReply(200, mobileAuthJson())]);
      final res = await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'pw-123456',
          ),
        ),
      );
      final mobile = res.mobile!;
      expect(mobile.accessToken, 'acc.tok.en');
      expect(mobile.refreshToken, 'refresh-token-value');
      expect(mobile.sessionExpiresAt, DateTime.utc(2027, 1, 3));
      expect(mobile.user.email, 'a@test.local');
      expect(mobile.user.name, isNull);
    });

    test('a web (cookie) auth body has no mobile tokens', () async {
      final h = Harness([
        JsonReply(200, {'user': userJson()}),
      ]);
      final res = await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'pw-123456',
          ),
        ),
      );
      expect(res.mobile, isNull);
    });

    test('request bodies serialize to the contract JSON', () async {
      final h = Harness([JsonReply(200, mobileAuthJson())]);
      await h.client.call(
        (api) => api.getAuthApi().login(
          loginRequest: LoginRequest(
            (b) => b
              ..email = 'a@test.local'
              ..password = 'pw-123456'
              ..deviceName = 'Pixel 9',
          ),
        ),
      );
      expect(jsonDecode(h.sent.single.bodyText), {
        'email': 'a@test.local',
        'password': 'pw-123456',
        'deviceName': 'Pixel 9',
      });
    });

    test('a 200 body that does not match the schema is an UnexpectedResponseFailure', () async {
      final h = Harness([
        JsonReply(200, {'items': 'not-a-list'}),
      ], token: 't');
      await expectLater(
        h.client.call((api) => api.getWardrobeApi().listWardrobeItems()),
        throwsA(isA<UnexpectedResponseFailure>()),
      );
    });

    test('error enum preserves every contract code and tolerates unknown ones', () {
      expect(ErrorResponseCodeEnum.values.map((e) => e.name), containsAll(['SESSION_BUSY', 'IDEMPOTENCY_IN_PROGRESS']));
      expect(ErrorResponseCodeEnum.values.length, 23); // 22 contract codes + unknown_default_open_api
    });
  });
}

int _indexOf(Uint8List haystack, Uint8List needle) {
  outer:
  for (var i = 0; i <= haystack.length - needle.length; i++) {
    for (var j = 0; j < needle.length; j++) {
      if (haystack[i + j] != needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
