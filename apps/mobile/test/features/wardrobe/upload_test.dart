import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_mobile/core/network/api_error_code.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/wardrobe/data/background_remover.dart';
import 'package:atlas_mobile/features/wardrobe/data/image_preparer.dart';
import 'package:atlas_mobile/features/wardrobe/data/jpeg_sanitizer.dart';
import 'package:atlas_mobile/features/wardrobe/data/photo_picker.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/add_item_controller.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/wardrobe_messages.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import 'wardrobe_fixtures.dart';

final _keyPattern = RegExp(r'^[A-Za-z0-9_-]{8,128}$');

/// Background removal on the phone: answers [result] and records its input.
class FakeRemover implements BackgroundRemover {
  FakeRemover(this.result);
  final Uint8List? result;
  final inputs = <Uint8List>[];

  @override
  Future<Uint8List?> cutout(Uint8List photo) async {
    inputs.add(photo);
    return result;
  }
}

class Setup {
  Setup({FakePicker? picker, BackgroundRemover? remover}) : picker = picker ?? FakePicker(result: photo()) {
    h = SessionHarness(stored: pair(1));
    container = ProviderContainer(
      overrides: [
        ...appOverrides(h),
        photoPickerProvider.overrideWithValue(this.picker),
        imagePreparerProvider.overrideWithValue(ImagePreparer(StubCompressor())),
        uploadSleepProvider.overrideWithValue((d) async {
          sleeps.add(d);
          await onSleep?.call(d);
        }),
        if (remover != null) backgroundRemoverProvider.overrideWithValue(remover),
      ],
    );
    addTearDown(container.dispose);
    container.listen(addItemControllerProvider, (_, s) => phases.add(s.phase));
  }

  late final SessionHarness h;
  late final ProviderContainer container;
  final FakePicker picker;
  final sleeps = <Duration>[];
  final phases = <AddPhase>[];

  /// Runs inside each IDEMPOTENCY_IN_PROGRESS wait.
  Future<void> Function(Duration)? onSleep;

  AddItemController get c => container.read(addItemControllerProvider.notifier);
  AddItemState get state => container.read(addItemControllerProvider);

  List<SentRequest> get uploads => h.backend.to(P.wardrobe).where((r) => r.method == 'POST').toList();

  /// Upload replies, in order (GET keeps the default empty list).
  void replies(List<FakeReply> list) {
    var n = 0;
    h.backend.handlers[P.wardrobe] = (r) {
      if (r.method == 'GET') return JsonReply(200, pageJson(const []));
      final reply = list[n.clamp(0, list.length - 1)];
      n++;
      return reply;
    };
  }

  Future<void> ready() async {
    await h.session.restore();
    await c.pick(PhotoSource.gallery);
  }
}

void main() {
  group('pick and prepare', () {
    test('a picked photo is prepared and gets ONE Idempotency-Key', () async {
      final s = Setup();
      await s.ready();
      expect(s.state.phase, AddPhase.preview);
      expect(s.state.job!.idempotencyKey, matches(_keyPattern));
      expect(s.state.job!.image.filename, 'IMG_0042.jpg');
      expect(JpegSanitizer.hasMetadata(s.state.job!.image.bytes), isFalse);
      expect(s.phases.first, AddPhase.preparing);
      expect(s.picker.calls, [PhotoSource.gallery]);
    });

    test('cancelled picker → back to choosing, nothing kept', () async {
      final s = Setup(picker: FakePicker());
      await s.ready();
      expect(s.state.phase, AddPhase.choose);
      expect(s.state.job, isNull);
    });

    test('permission refused → explained, no upload', () async {
      final s = Setup(picker: FakePicker(denied: true));
      await s.h.session.restore();
      await s.c.pick(PhotoSource.camera);
      expect(
        (s.state.phase, s.state.reject, s.state.deniedSource),
        (AddPhase.rejected, RejectReason.accessDenied, PhotoSource.camera),
      );
    });

    test('a photo too small is rejected on the device (no request)', () async {
      final s = Setup(picker: FakePicker(result: PickedPhoto(fixtureBytes('tiny.jpg'), 'x.jpg')));
      await s.ready();
      expect((s.state.phase, s.state.reject), (AddPhase.rejected, RejectReason.tooSmall));
      expect(s.uploads, isEmpty);
    });

    test('a new photo gets a new key; the old job is dropped', () async {
      final s = Setup();
      await s.ready();
      final first = s.state.job!.idempotencyKey;
      s.c.reset();
      expect(s.state.job, isNull);
      await s.c.pick(PhotoSource.camera);
      expect(s.state.job!.idempotencyKey, isNot(first));
    });
  });

  group('background removal (on the phone)', () {
    test('removed: the cut-out photo is prepared and uploaded; the remover got the prepared photo', () async {
      final remover = FakeRemover(fixtureBytes('plain_landscape.jpg'));
      final s = Setup(remover: remover);
      await s.ready();
      expect(s.state.phase, AddPhase.preview);
      expect(remover.inputs.single, same(s.state.original!.bytes), reason: 'prepared bytes: oriented, no metadata');
      expect(s.state.cutout, isNotNull);
      expect(s.state.usesCutout, isTrue);
      expect(s.state.job!.image, same(s.state.cutout));
      expect(s.state.job!.image.filename, 'IMG_0042.jpg');
      expect(JpegSanitizer.hasMetadata(s.state.job!.image.bytes), isFalse);

      s.replies([JsonReply(201, uploadJson('new-1'))]);
      await s.c.upload();
      expect(containsBytes(s.uploads.single.body, s.state.job!.image.bytes), isTrue);
    });

    test('the user can keep the original instead; each version is its own upload key', () async {
      final s = Setup(remover: FakeRemover(fixtureBytes('plain_landscape.jpg')));
      await s.ready();
      final cutKey = s.state.job!.idempotencyKey;
      await s.c.chooseCutout(false);
      expect(s.state.usesCutout, isFalse);
      expect(s.state.job!.image, same(s.state.original));
      expect(s.state.job!.idempotencyKey, isNot(cutKey));
      await s.c.chooseCutout(true);
      expect(s.state.usesCutout, isTrue);

      await s.c.chooseCutout(false);
      final original = s.state.original!;
      s.replies([JsonReply(201, uploadJson('new-1'))]);
      await s.c.upload();
      expect(containsBytes(s.uploads.single.body, original.bytes), isTrue);
      expect(s.uploads, hasLength(1));
    });

    test('not available or nothing found: the original photo, no choice offered', () async {
      final s = Setup(remover: FakeRemover(null));
      await s.ready();
      expect(s.state.phase, AddPhase.preview);
      expect(s.state.cutout, isNull);
      expect(s.state.usesCutout, isFalse);
      expect(s.state.job!.image, same(s.state.original));
      await s.c.chooseCutout(true);
      expect(s.state.job!.image, same(s.state.original), reason: 'nothing to switch to');
    });

    test('an unusable cut-out is ignored and the original is used', () async {
      final s = Setup(remover: FakeRemover(Uint8List.fromList([1, 2, 3, 4])));
      await s.ready();
      expect(s.state.phase, AddPhase.preview);
      expect(s.state.cutout, isNull);
      expect(s.state.job!.image, same(s.state.original));
    });

    test('the platform remover answers null off Android (tests run on the host)', () async {
      expect(await const PlatformBackgroundRemover().cutout(fixtureBytes('plain_landscape.jpg')), isNull);
    });
  });

  group('upload', () {
    test('multipart body: exact prepared bytes, file name, JPEG type, Content-Length, key, Bearer', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(201, uploadJson('new-1'))]);
      final job = s.state.job!;
      await s.c.upload();

      final r = s.uploads.single;
      expect(r.header('Idempotency-Key'), job.idempotencyKey);
      expect(r.header('Authorization'), 'Bearer ${access(1)}');
      expect(r.header('X-Atlas-Client'), 'mobile');
      expect(r.header('Content-Type').toString(), startsWith('multipart/form-data; boundary='));
      expect(int.parse(r.header('Content-Length').toString()), r.body.length);
      final head = latin1.decode(r.body.sublist(0, 400), allowInvalid: true);
      expect(head, contains('name="file"; filename="IMG_0042.jpg"'));
      expect(head.toLowerCase(), contains('content-type: image/jpeg'));
      expect(containsBytes(r.body, job.image.bytes), isTrue, reason: 'the exact prepared bytes');
      // No EXIF/GPS anywhere in what leaves the device.
      expect(containsBytes(r.body, ascii.encode('Exif')), isFalse);
      expect(containsBytes(r.body, ascii.encode('GPS')), isFalse);
      expect(containsBytes(r.body, ascii.encode('Tashkent')), isFalse);
      expect(s.state.phase, AddPhase.completed);
    });

    test('phases: preparing → preview → uploading → analysing → success; the item joins the list', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(201, uploadJson('new-1'))]);
      await s.c.upload();
      expect(s.phases.toSet().toList(), [
        AddPhase.preparing,
        AddPhase.preview,
        AddPhase.uploading,
        AddPhase.analysing,
        AddPhase.completed,
      ]);
      expect(s.container.read(wardrobeListProvider).items.map((i) => i.id), contains('new-1'));
    });

    test('network failure: no automatic retry; Retry sends the SAME key, bytes and file name', () async {
      final s = Setup();
      await s.ready();
      s.replies([TransportFailure(DioExceptionType.connectionError), JsonReply(201, uploadJson('new-1'))]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.failed);
      expect(s.uploads, hasLength(1), reason: 'uploads are never retried automatically');
      expect(s.state.job, isNotNull, reason: 'the job is kept for Retry');
      await s.c.upload(); // Retry
      expect(s.state.phase, AddPhase.completed);
      final [a, b] = s.uploads;
      expect(b.header('Idempotency-Key'), a.header('Idempotency-Key'));
      final ja = s.state.job!.image.bytes;
      expect(containsBytes(a.body, ja) && containsBytes(b.body, ja), isTrue);
      expect(latin1.decode(b.body.sublist(0, 400), allowInvalid: true), contains('filename="IMG_0042.jpg"'));
    });

    test('timeout after the server processed it: Retry → replayed 201, the item appears once', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        TransportFailure(DioExceptionType.receiveTimeout),
        JsonReply(201, uploadJson('new-1'), headers: {'Idempotent-Replayed': 'true'}),
      ]);
      await s.c.upload();
      await s.c.upload();
      expect(s.state.result!.replayed, isTrue);
      s.container.read(wardrobeListProvider.notifier).insert(s.state.result!.item); // a second insert
      expect(s.container.read(wardrobeListProvider).items.where((i) => i.id == 'new-1'), hasLength(1));
    });

    test('IDEMPOTENCY_IN_PROGRESS: waits Retry-After (capped at 30 s) and resends the same job', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '3'}),
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '300'}),
        JsonReply(201, uploadJson('new-1')),
      ]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.completed);
      expect(s.sleeps, [const Duration(seconds: 3), const Duration(seconds: 30)]);
      expect(s.uploads.map((r) => r.header('Idempotency-Key')).toSet(), hasLength(1));
    });

    test('IDEMPOTENCY_IN_PROGRESS more than 3 times → failed (Retry available)', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '1'}),
      ]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.failed);
      expect(s.uploads, hasLength(4));
      expect(s.sleeps, hasLength(3));
    });

    test('IDEMPOTENCY_KEY_MISMATCH: job discarded, a new photo is required (never a silent new key)', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(409, errorBody('IDEMPOTENCY_KEY_MISMATCH'))]);
      await s.c.upload();
      expect((s.state.phase, s.state.reject, s.state.job), (AddPhase.rejected, RejectReason.keyMismatch, null));
      await s.c.upload(); // nothing to retry
      expect(s.uploads, hasLength(1));
    });

    for (final (code, status, reason) in [
      ('PAYLOAD_TOO_LARGE', 413, RejectReason.tooLarge),
      ('UNSUPPORTED_IMAGE_FORMAT', 415, RejectReason.unsupported),
      ('UNSUPPORTED_MEDIA_TYPE', 415, RejectReason.unsupported),
      ('IMAGE_DIMENSIONS', 422, RejectReason.dimensions),
      ('INVALID_IMAGE', 422, RejectReason.unreadable),
    ]) {
      test('$code → rejected (pick another photo), not retried', () async {
        final s = Setup();
        await s.ready();
        s.replies([JsonReply(status, errorBody(code))]);
        await s.c.upload();
        expect((s.state.phase, s.state.reject), (AddPhase.rejected, reason));
        expect(s.uploads, hasLength(1));
      });
    }

    for (final (subject, reason) in [
      ('no_garment', RejectReason.notAGarment),
      ('multiple_garments', RejectReason.multipleGarments),
      ('unclear', RejectReason.unclearPhoto),
      (null, RejectReason.notAGarment),
    ]) {
      test('NOT_A_GARMENT ($subject) → rejected with its own explanation, not retried', () async {
        final s = Setup();
        await s.ready();
        final details = subject == null
            ? null
            : [
                {'path': 'subject', 'message': subject},
              ];
        s.replies([JsonReply(422, errorBody('NOT_A_GARMENT', details: details))]);
        await s.c.upload();
        expect((s.state.phase, s.state.reject), (AddPhase.rejected, reason));
        expect(s.uploads, hasLength(1));
      });
    }

    test('AI_QUOTA_EXCEEDED → rejected with the daily-limit explanation, not retried', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(429, errorBody('AI_QUOTA_EXCEEDED'), headers: {'Retry-After': '3600'}),
      ]);
      await s.c.upload();
      expect((s.state.phase, s.state.reject), (AddPhase.rejected, RejectReason.aiQuota));
      expect(WardrobeMessages.reject(RejectReason.aiQuota), contains('yarim tunda'));
      // The server decides the limit (and may change it): the text names no number.
      expect(WardrobeMessages.reject(RejectReason.aiQuota), isNot(matches(RegExp(r'\d'))));
      expect(s.uploads, hasLength(1));
    });

    test('AI_UNAVAILABLE → failed with the same job (Retry sends the SAME key), never automatic', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(503, errorBody('AI_UNAVAILABLE'), headers: {'Retry-After': '15'}),
        JsonReply(201, uploadJson('ai-1')),
      ]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.failed);
      expect(
        s.state.failure,
        isA<ApiHttpFailure>()
            .having((f) => f.code, 'code', ApiErrorCode.aiUnavailable)
            .having((f) => f.retryable, 'retryable', true),
      );
      // For an upload this code means "busy, try again" (the server could not
      // take or process the picture now): the screen does not say the AI is down.
      expect(WardrobeMessages.uploadFailed(s.state.failure), 'Xizmat hozir band. Birozdan so‘ng qayta urinib ko‘ring.');
      expect(s.uploads, hasLength(1));
      await s.c.upload(); // Retry
      expect(s.uploads, hasLength(2));
      expect(s.state.phase, AddPhase.completed);
      expect(s.uploads[1].header('Idempotency-Key'), s.uploads[0].header('Idempotency-Key'));
    });

    test('server error → failed, Retry possible', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(500, errorBody('INTERNAL'))]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.failed);
      expect(s.state.failure, isA<ApiHttpFailure>().having((f) => f.code, 'code', ApiErrorCode.internal));
    });

    test('cancel while uploading: the request is aborted, the job is kept, Retry sends the SAME key', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(201, uploadJson('new-1'))]);
      s.h.backend.gates[P.wardrobe] = Gate();
      final running = s.c.upload();
      await pumpEventQueue();
      expect(s.state.busy, isTrue);
      s.c.cancel();
      await running;
      expect(s.state.busy, isFalse);
      expect(s.state.phase, AddPhase.failed);
      expect(s.state.failure, isA<CancelledFailure>());
      expect(s.state.job, isNotNull, reason: 'kept: the server may have stored it; a retry is replayed');
      s.h.backend.gates.remove(P.wardrobe);
      await s.c.upload();
      expect(s.state.phase, AddPhase.completed);
      expect(s.uploads.map((r) => r.header('Idempotency-Key')).toSet(), hasLength(1));
    });

    test('cancel while waiting for a running upload stops the waiting', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '5'}),
      ]);
      s.onSleep = (_) async => s.c.cancel();
      await s.c.upload();
      expect(s.state.phase, AddPhase.failed);
      expect(s.state.failure, isA<CancelledFailure>());
      expect(s.uploads, hasLength(1), reason: 'no request after the cancel');
    });

    test('cancel ends a long wait for a running upload at once, not when the wait is over', () async {
      final s = Setup();
      await s.ready();
      s.replies([
        JsonReply(409, errorBody('IDEMPOTENCY_IN_PROGRESS'), headers: {'Retry-After': '30'}),
      ]);
      s.onSleep = (_) => Completer<void>().future; // the wait never ends by itself
      final run = s.c.upload();
      await pumpEventQueue();
      expect(s.state.phase, AddPhase.analysing);
      s.c.cancel();
      await run.timeout(const Duration(seconds: 2));
      expect(s.state.phase, AddPhase.failed);
      expect(s.state.failure, isA<CancelledFailure>());
      expect(s.uploads, hasLength(1), reason: 'no request after the cancel');
    });

    test('a cancelled upload still reloads the wardrobe on leaving, even after another photo was added', () async {
      final s = Setup();
      await s.ready();
      final hold = Completer<void>();
      var posts = 0;
      s.h.backend.handlers[P.wardrobe] = (r) async {
        if (r.method != 'POST') return JsonReply(200, pageJson(const []));
        if (++posts == 1) await hold.future; // upload A hangs, then is cancelled
        return JsonReply(201, uploadJson('new-$posts'));
      };
      final a = s.c.upload();
      await pumpEventQueue();
      s.c.cancel();
      await a;
      expect(s.state.failure, isA<CancelledFailure>());
      s.c.reset(); // "Boshqa rasm tanlash"
      await s.c.pick(PhotoSource.gallery);
      await s.c.upload(); // upload B succeeds
      expect(s.state.phase, isNot(AddPhase.failed));
      final lists = s.h.backend.to(P.wardrobe).where((r) => r.method == 'GET').length;
      s.c.closed();
      await pumpEventQueue();
      expect(
        s.h.backend.to(P.wardrobe).where((r) => r.method == 'GET').length,
        lists + 1,
        reason: 'A may be stored on the server: the wardrobe reloads',
      );
      hold.complete();
    });

    test('cancel is ignored when nothing is running', () async {
      final s = Setup();
      await s.ready();
      s.c.cancel();
      expect(s.state.phase, AddPhase.preview);
    });

    test('double tap: one upload request', () async {
      final s = Setup();
      await s.ready();
      s.replies([JsonReply(201, uploadJson('new-1'))]);
      await Future.wait([s.c.upload(), s.c.upload(), s.c.upload()]);
      expect(s.uploads, hasLength(1));
    });

    test('401 during upload → session refresh → the multipart request is re-sent intact', () async {
      final s = Setup();
      await s.ready();
      s.h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      s.replies([JsonReply(401, errorBody('UNAUTHORIZED')), JsonReply(201, uploadJson('new-1'))]);
      final job = s.state.job!;
      await s.c.upload();
      expect(s.state.phase, AddPhase.completed);
      final [a, b] = s.uploads;
      expect(a.header('Authorization'), 'Bearer ${access(1)}');
      expect(b.header('Authorization'), 'Bearer ${access(2)}');
      expect(b.header('Idempotency-Key'), job.idempotencyKey);
      expect(containsBytes(b.body, job.image.bytes), isTrue);
      expect(int.parse(b.header('Content-Length').toString()), b.body.length);
      expect(s.h.backend.calls(P.refresh), 1);
    });

    test('session ended during upload → flow reset; the router takes the user to sign-in', () async {
      final s = Setup();
      await s.ready();
      s.h.backend.script(P.refresh, [JsonReply(401, errorBody('REFRESH_REUSED'))]);
      s.replies([JsonReply(401, errorBody('UNAUTHORIZED'))]);
      await s.c.upload();
      expect(s.state.phase, AddPhase.choose);
      expect(s.state.job, isNull);
      expect(s.h.session.state, const SessionExpired(SignedOutReason.reused));
    });
  });
}
