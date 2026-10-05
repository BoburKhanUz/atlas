import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../data/analysis_review.dart';
import '../data/image_preparer.dart';
import '../data/pending_upload_store.dart';
import '../data/photo_picker.dart';
import '../data/sha256.dart';
import '../data/upload_job.dart';
import '../data/wardrobe_repository.dart';
import '../providers.dart';

/// The add-item lifecycle. Analysis happens inside the upload request, so
/// its response is the final result — there is no polling and no job:
///
///   choose → preparing → preview → uploading (bytes) → analysing (waiting)
///     → completed        (nothing to review)
///     → needsCorrection  (low-confidence attributes to review)
///     → failed           (Retry: same job)
///     → rejected         (a new photo is needed)
///
/// "analysing" always ends: the response, the bounded receive timeout
/// (failed), the end of the session, or an app restart (the recovery
/// record then explains what happened).
enum AddPhase { choose, preparing, preview, uploading, analysing, completed, needsCorrection, failed, rejected }

/// Why a photo cannot be uploaded at all (a new photo is needed).
enum RejectReason { tooSmall, tooLarge, unreadable, orientation, unsupported, dimensions, keyMismatch, accessDenied }

@immutable
class AddItemState {
  const AddItemState({
    this.phase = AddPhase.choose,
    this.job,
    this.progress = 0,
    this.result,
    this.failure,
    this.reject,
    this.deniedSource,
    this.recovered = false,
    this.acknowledged = const {},
  });

  final AddPhase phase;

  /// The upload action (bytes + filename + its one Idempotency-Key).
  final UploadJob? job;

  /// 0–1 while uploading.
  final double progress;
  final UploadResult? result;

  /// Retryable failure (phase failed).
  final ApiFailure? failure;
  final RejectReason? reject;
  final PhotoSource? deniedSource;

  /// The job reuses the key of an interrupted earlier upload of the same
  /// photo (same bytes and file name).
  final bool recovered;

  /// "This is correct" — for this review session only; never sent.
  final Set<ItemAttribute> acknowledged;

  WardrobeItem? get item => result?.item;

  /// Low-confidence attributes still to look at.
  Set<ItemAttribute> get toReview {
    final i = item;
    return i == null ? const {} : attributesToReview(i, acknowledged: acknowledged);
  }

  bool get busy => phase == AddPhase.preparing || phase == AddPhase.uploading || phase == AddPhase.analysing;

  AddItemState copyWith({AddPhase? phase, UploadResult? result, Set<ItemAttribute>? acknowledged}) => AddItemState(
    phase: phase ?? this.phase,
    job: job,
    progress: progress,
    result: result ?? this.result,
    failure: failure,
    reject: reject,
    deniedSource: deniedSource,
    recovered: recovered,
    acknowledged: acknowledged ?? this.acknowledged,
  );
}

class AddItemController extends Notifier<AddItemState> {
  /// IDEMPOTENCY_IN_PROGRESS: automatic waits (Retry-After, ≤ 30 s), at most 3.
  static const maxInProgressWaits = 3;
  static const maxInProgressWait = Duration(seconds: 30);

  /// SHA-256 of the current job's bytes (for the recovery record).
  String? _hash;

  @override
  AddItemState build() {
    // An edit saved elsewhere (editor) updates the item under review.
    ref.listen(wardrobeItemUpdatesProvider, (_, updated) {
      final current = state.item;
      if (updated == null || current == null || updated.id != current.id) return;
      final result = UploadResult(item: updated, detection: state.result!.detection, replayed: state.result!.replayed);
      state = _settled(state.copyWith(result: result));
    });
    unawaited(Future.microtask(_recoverLostPhoto));
    return const AddItemState();
  }

  String? get _userId => ref.read(authStateProvider).user?.id;
  PendingUploadStore get _store => ref.read(pendingUploadStoreProvider);

  /// Android: the camera photo of a run the system killed.
  Future<void> _recoverLostPhoto() async {
    if (!ref.mounted || state.phase != AddPhase.choose) return;
    final lost = await ref.read(photoPickerProvider).recoverLost();
    if (lost == null || !ref.mounted || state.phase != AddPhase.choose) return;
    AppLog.info('recovered a photo from an interrupted camera session');
    await _prepare(() async => lost);
  }

  /// Pick and prepare a photo.
  Future<void> pick(PhotoSource source) async {
    if (state.busy) return;
    await _prepare(() => ref.read(photoPickerProvider).pick(source), source: source);
  }

  Future<void> _prepare(Future<PickedPhoto?> Function() obtain, {PhotoSource? source}) async {
    state = const AddItemState(phase: AddPhase.preparing);
    _hash = null;
    try {
      final picked = await obtain();
      if (!ref.mounted) return;
      if (picked == null) {
        state = const AddItemState();
        return;
      }
      final prepared = await ref.read(imagePreparerProvider).prepare(picked.bytes, originalName: picked.name);
      if (!ref.mounted) return;
      final hash = sha256Hex(prepared.bytes);
      // A new key only for a new payload. The same prepared bytes AND file
      // name as an interrupted upload reuse its key (duplicate-safe).
      final userId = _userId;
      final pending = userId == null ? null : await _store.read(userId);
      if (!ref.mounted) return;
      final reuse = pending != null && pending.matches(hash, prepared.filename);
      _hash = hash;
      state = AddItemState(
        phase: AddPhase.preview,
        job: reuse ? UploadJob.recovered(prepared, pending.idempotencyKey) : UploadJob.create(prepared),
        recovered: reuse,
      );
    } on PhotoAccessDenied catch (e) {
      if (ref.mounted) {
        state = AddItemState(phase: AddPhase.rejected, reject: RejectReason.accessDenied, deniedSource: e.source);
      }
    } on ImagePreparationException catch (e) {
      AppLog.info('photo rejected before upload: ${e.error.name}');
      if (ref.mounted) state = AddItemState(phase: AddPhase.rejected, reject: _fromPreparation(e.error));
    } on Object catch (e) {
      AppLog.warn('photo could not be picked (${e.runtimeType})');
      if (ref.mounted) state = const AddItemState(phase: AddPhase.rejected, reject: RejectReason.unreadable);
    }
  }

  /// Upload the job; also the Retry action (same job: same key, same bytes,
  /// same file name). Ignored while an upload is running (double tap).
  Future<void> upload() async {
    final job = state.job;
    if (job == null || (state.phase != AddPhase.preview && state.phase != AddPhase.failed)) return;
    final recovered = state.recovered;
    state = AddItemState(phase: AddPhase.uploading, job: job, recovered: recovered);
    await _remember(job);
    var waits = 0;
    while (true) {
      try {
        final result = await ref
            .read(wardrobeRepositoryProvider)
            .upload(
              job,
              onSendProgress: (sent, total) {
                if (!ref.mounted || total <= 0) return;
                final p = (sent / total).clamp(0.0, 1.0);
                state = AddItemState(
                  phase: p >= 1 ? AddPhase.analysing : AddPhase.uploading,
                  job: job,
                  progress: p,
                  recovered: recovered,
                );
              },
            );
        await _forget();
        if (!ref.mounted) return;
        ref.read(wardrobeListProvider.notifier).insert(result.item);
        state = _settled(AddItemState(job: job, progress: 1, result: result, recovered: recovered));
        return;
      } on ApiFailure catch (f) {
        if (!ref.mounted) return;
        AppLog.info('upload failed: ${f.describe()}');
        if (f is ApiHttpFailure && f.code == ApiErrorCode.idempotencyInProgress && waits < maxInProgressWaits) {
          waits++;
          var wait = f.retryAfter ?? const Duration(seconds: 2);
          if (wait > maxInProgressWait) wait = maxInProgressWait;
          state = AddItemState(phase: AddPhase.analysing, job: job, progress: 1, recovered: recovered);
          await ref.read(uploadSleepProvider)(wait);
          if (!ref.mounted) return;
          continue; // same job
        }
        final next = _afterFailure(job, f, recovered);
        if (next.phase == AddPhase.rejected) await _forget();
        if (ref.mounted) state = next;
        return;
      }
    }
  }

  /// The recovery record for this job, written before the first attempt
  /// (kept on failure; an earlier record of the same payload is kept as is
  /// so its 24 h window still matches the server's).
  Future<void> _remember(UploadJob job) async {
    final userId = _userId;
    final hash = _hash;
    if (userId == null || hash == null) return;
    final existing = await _store.read(userId);
    if (existing != null && existing.idempotencyKey == job.idempotencyKey) return;
    await _store.save(
      PendingUpload(
        userId: userId,
        idempotencyKey: job.idempotencyKey,
        sha256: hash,
        filename: job.image.filename,
        createdAt: DateTime.now().toUtc(),
      ),
    );
  }

  Future<void> _forget() async {
    final userId = _userId;
    if (userId != null) await _store.clear(userId);
  }

  AddItemState _afterFailure(UploadJob job, ApiFailure f, bool recovered) {
    if (f is SessionEndedFailure) return const AddItemState(); // the router leaves for sign-in
    if (f is ApiHttpFailure) {
      final reject = switch (f.code) {
        // The key was used for different bytes: never reuse it — new photo.
        ApiErrorCode.idempotencyKeyMismatch => RejectReason.keyMismatch,
        ApiErrorCode.payloadTooLarge => RejectReason.tooLarge,
        ApiErrorCode.unsupportedImageFormat || ApiErrorCode.unsupportedMediaType => RejectReason.unsupported,
        ApiErrorCode.imageDimensions => RejectReason.dimensions,
        ApiErrorCode.invalidImage => RejectReason.unreadable,
        _ => null,
      };
      if (reject != null) return AddItemState(phase: AddPhase.rejected, reject: reject);
    }
    // Network, timeout, 5xx, busy, rate limit, still in progress: keep the
    // job; the user retries it (never automatically).
    return AddItemState(phase: AddPhase.failed, job: job, failure: f, recovered: recovered);
  }

  /// completed or needsCorrection, from the server's item and the
  /// acknowledgements of this session.
  static AddItemState _settled(AddItemState s) =>
      s.copyWith(phase: s.toReview.isEmpty ? AddPhase.completed : AddPhase.needsCorrection);

  /// "This is correct": hides the warning for this review session only. No
  /// request, no server change.
  void acknowledge(ItemAttribute attribute) {
    if (state.item == null) return;
    state = _settled(state.copyWith(acknowledged: {...state.acknowledged, attribute}));
  }

  /// Start over with another photo (the job is dropped; a recovery record
  /// stays until success, rejection or expiry).
  void reset() {
    if (state.busy) return;
    _hash = null;
    state = const AddItemState();
  }

  static RejectReason _fromPreparation(PreparationError e) => switch (e) {
    PreparationError.tooSmall => RejectReason.tooSmall,
    PreparationError.tooLarge => RejectReason.tooLarge,
    PreparationError.unreadable => RejectReason.unreadable,
    PreparationError.orientation => RejectReason.orientation,
  };
}
