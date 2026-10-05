// Real-backend integration for the wardrobe: upload / list / detail /
// delete, idempotency replay and mismatch, validation errors, signed media,
// and an upload across an expired access token. Skipped unless
// ATLAS_IT_BASE_URL is set (local, disposable backend only — see
// backend_session_test.dart).
import 'dart:io';
import 'dart:typed_data';

import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/jpeg_sanitizer.dart';
import 'package:atlas_mobile/features/wardrobe/data/upload_job.dart';
import 'package:atlas_mobile/features/wardrobe/data/wardrobe_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_session.dart' show MemorySecureStore;
import '../support/jpeg_fixtures.dart';
import 'backend_session_test.dart' show Device, registered;

final _base = Platform.environment['ATLAS_IT_BASE_URL'];

/// The landscape fixture as the preparation pipeline outputs it (device
/// metadata added, then stripped by our sanitizer).
PreparedImage prepared({String name = 'shirt.jpg', String fixture = 'plain_landscape.jpg', int w = 640, int h = 480}) =>
    PreparedImage(
      bytes: JpegSanitizer.strip(withDeviceMetadata(fixtureBytes(fixture), orientation: 1)),
      filename: name,
      width: w,
      height: h,
    );

Future<Object> attempt(Future<Object> Function() f) async {
  try {
    return await f();
  } on Object catch (e) {
    return e;
  }
}

Matcher failureWith(ApiErrorCode code, int status) =>
    isA<ApiHttpFailure>().having((f) => (f.code, f.statusCode), 'code/status', (code, status));

void main() {
  group('real backend: wardrobe', skip: _base == null ? 'set ATLAS_IT_BASE_URL to run' : null, () {
    test('upload → detection → list → detail → delete → 404', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final job = UploadJob.create(prepared());
      final result = await repo.upload(job);
      expect(result.replayed, isFalse);
      expect(result.item.id, isNotEmpty);
      expect(result.detection.mock, isTrue, reason: 'contract: mock vision for now');
      expect(result.item.images, isNotEmpty);
      final list = await repo.list();
      expect(list.items.map((i) => i.id), [result.item.id]);
      final item = await repo.get(result.item.id);
      expect(item.category, result.item.category);
      await repo.delete(result.item.id);
      expect(await attempt(() => repo.get(result.item.id)), failureWith(ApiErrorCode.notFound, 404));
      expect((await repo.list()).items, isEmpty);
    });

    test('same key + same bytes + same file name → replayed original, still one item', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final job = UploadJob.create(prepared());
      final first = await repo.upload(job);
      final second = await repo.upload(job);
      expect(second.replayed, isTrue);
      expect(second.item.id, first.item.id);
      expect((await repo.list()).items, hasLength(1));
    });

    test('same key + different bytes → IDEMPOTENCY_KEY_MISMATCH', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final job = UploadJob.create(prepared());
      await repo.upload(job);
      final other = UploadJob.create(prepared(fixture: 'rotated_cw90_reference.jpg', w: 480, h: 640));
      final mismatched = await attempt(() => repo.upload(other.withKeyForTest(job.idempotencyKey)));
      expect(mismatched, failureWith(ApiErrorCode.idempotencyKeyMismatch, 409));
    });

    test('same key + same bytes + another FILE NAME → mismatch (the file name is part of the payload)', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final job = UploadJob.create(prepared(name: 'a.jpg'));
      await repo.upload(job);
      final renamed = UploadJob.create(prepared(name: 'b.jpg')).withKeyForTest(job.idempotencyKey);
      expect(await attempt(() => repo.upload(renamed)), failureWith(ApiErrorCode.idempotencyKeyMismatch, 409));
    });

    test('validation: < 256 px → IMAGE_DIMENSIONS; HEIC → 415; not an image → 415/422', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      PreparedImage raw(Uint8List b, String name) => PreparedImage(bytes: b, filename: name, width: 1, height: 1);
      expect(
        await attempt(() => repo.upload(UploadJob.create(raw(fixtureBytes('tiny.jpg'), 'tiny.jpg')))),
        failureWith(ApiErrorCode.imageDimensions, 422),
      );
      final heic = await attempt(() => repo.upload(UploadJob.create(raw(fixtureBytes('sample.heic'), 'x.heic'))));
      expect(heic, isA<ApiHttpFailure>().having((f) => f.statusCode, 'status', 415));
      final junk = await attempt(
        () => repo.upload(UploadJob.create(raw(Uint8List.fromList(List.filled(4096, 7)), 'x.jpg'))),
      );
      expect(junk, isA<ApiHttpFailure>().having((f) => [415, 422].contains(f.statusCode), '415/422', isTrue));
      expect((await repo.list()).items, isEmpty, reason: 'nothing stored for rejected uploads');
    });

    test('cursor pagination and the category filter', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      for (var i = 0; i < 3; i++) {
        await repo.upload(UploadJob.create(prepared(name: 'item$i.jpg')));
      }
      final p1 = await d.client.call((api) => api.getWardrobeApi().listWardrobeItems(limit: 2));
      expect(p1.items, hasLength(2));
      expect(p1.nextCursor, isNotNull);
      final p2 = await d.client.call((api) => api.getWardrobeApi().listWardrobeItems(limit: 2, cursor: p1.nextCursor));
      expect(p2.items, hasLength(1));
      expect(p2.nextCursor, isNull);
      expect({...p1.items.map((i) => i.id), ...p2.items.map((i) => i.id)}, hasLength(3));
      final category = p1.items.first.category;
      final filtered = await repo.list(category: category);
      expect(filtered.items.every((i) => i.category == category), isTrue);
      final other = wardrobeCategories.firstWhere((c) => c != 'all' && c != category);
      expect((await repo.list(category: other)).items.every((i) => i.category == other), isTrue);
    });

    test('signed media: display + thumbnail load without Bearer; tampered or altered URLs fail', () async {
      final d = await registered();
      final repo = WardrobeRepository(d.client);
      final item = (await repo.upload(UploadJob.create(prepared()))).item;
      final image = item.primaryImage!;
      Future<Response<List<int>>> get(String url) =>
          d.client.dio.get<List<int>>(url, options: Options(responseType: ResponseType.bytes));
      for (final url in [image.url, image.thumbnailUrl!]) {
        final r = await get(url);
        expect(r.statusCode, 200);
        expect(r.data, isNotEmpty);
        expect(r.headers.value('content-type'), startsWith('image/'));
      }
      final mediaCalls = d.apiAdapter.authorization.entries.where((e) => e.key.startsWith('/api/v1/media/'));
      expect(mediaCalls, isNotEmpty);
      expect(
        mediaCalls.expand((e) => e.value),
        everyElement(isNull),
        reason: 'never a Bearer to the public media endpoint',
      );
      expect(image.urlExpiresAt.isAfter(DateTime.now()), isTrue);

      final tampered = image.url.replaceFirstMapped(RegExp(r'sig=([^&])'), (m) => 'sig=${m[1] == 'A' ? 'B' : 'A'}');
      final extended = image.url.replaceFirstMapped(RegExp(r'exp=(\d+)'), (m) => 'exp=${int.parse(m[1]!) + 3600}');
      for (final bad in [tampered, extended]) {
        final e = await attempt(() => get(bad));
        expect(e, isA<DioException>().having((x) => x.response?.statusCode, 'status', anyOf(400, 403, 404)));
      }
    });

    test('upload across an expired access token: refresh, then the multipart request is re-sent', () async {
      final d = await registered();
      final s = d.stored!;
      // The device believes its access token is valid for an hour: the
      // server answers 401 and the session layer refreshes and re-sends.
      final e = Device(
        kv: MemorySecureStore()
          ..put(
            SessionTokens(
              user: s.user,
              accessToken: s.accessToken,
              accessTokenExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
              refreshToken: s.refreshToken,
              refreshTokenExpiresAt: s.refreshTokenExpiresAt,
              sessionExpiresAt: s.sessionExpiresAt,
            ),
          ),
      );
      await e.session.restore();
      await Future<void>.delayed(const Duration(seconds: 11));
      final repo = WardrobeRepository(e.client);
      final result = await repo.upload(UploadJob.create(prepared()));
      expect(result.item.id, isNotEmpty);
      expect(e.refreshCalls, 1);
      expect(e.apiAdapter.counts['/api/v1/wardrobe/items'], 2, reason: '401, then the re-sent upload');
      expect((await repo.list()).items, hasLength(1), reason: 'one item, not two');
    });
  });
}
