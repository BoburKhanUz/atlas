import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../data/image_preparer.dart';
import '../data/photo_picker.dart';
import '../data/upload_job.dart';
import '../data/wardrobe_repository.dart';
import '../providers.dart';

/// preparing → preview → uploading (bytes) → analysing (waiting for the
/// response, which carries the detected item) → success | failed (Retry) |
/// rejected (pick another photo).
enum AddPhase { choose, preparing, preview, uploading, analysing, success, failed, rejected }

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

  bool get busy => phase == AddPhase.preparing || phase == AddPhase.uploading || phase == AddPhase.analysing;
}

class AddItemController extends Notifier<AddItemState> {
  /// IDEMPOTENCY_IN_PROGRESS: automatic waits (Retry-After, ≤ 30 s), at most 3.
  static const maxInProgressWaits = 3;
  static const maxInProgressWait = Duration(seconds: 30);

  @override
  AddItemState build() => const AddItemState();

  /// Pick and prepare a photo. A new photo is the only thing that creates a
  /// new Idempotency-Key.
  Future<void> pick(PhotoSource source) async {
    if (state.busy) return;
    state = const AddItemState(phase: AddPhase.preparing);
    try {
      final picked = await ref.read(photoPickerProvider).pick(source);
      if (!ref.mounted) return;
      if (picked == null) {
        state = const AddItemState();
        return;
      }
      final prepared = await ref.read(imagePreparerProvider).prepare(picked.bytes, originalName: picked.name);
      if (!ref.mounted) return;
      state = AddItemState(phase: AddPhase.preview, job: UploadJob.create(prepared));
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
    state = AddItemState(phase: AddPhase.uploading, job: job);
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
                state = AddItemState(phase: p >= 1 ? AddPhase.analysing : AddPhase.uploading, job: job, progress: p);
              },
            );
        if (!ref.mounted) return;
        ref.read(wardrobeListProvider.notifier).insert(result.item);
        state = AddItemState(phase: AddPhase.success, job: job, progress: 1, result: result);
        return;
      } on ApiFailure catch (f) {
        if (!ref.mounted) return;
        AppLog.info('upload failed: ${f.describe()}');
        if (f is ApiHttpFailure && f.code == ApiErrorCode.idempotencyInProgress && waits < maxInProgressWaits) {
          waits++;
          var wait = f.retryAfter ?? const Duration(seconds: 2);
          if (wait > maxInProgressWait) wait = maxInProgressWait;
          state = AddItemState(phase: AddPhase.analysing, job: job, progress: 1);
          await ref.read(uploadSleepProvider)(wait);
          if (!ref.mounted) return;
          continue; // same job
        }
        state = _afterFailure(job, f);
        return;
      }
    }
  }

  AddItemState _afterFailure(UploadJob job, ApiFailure f) {
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
    return AddItemState(phase: AddPhase.failed, job: job, failure: f);
  }

  /// Start over with another photo (the old job and its key are dropped).
  void reset() {
    if (state.busy) return;
    state = const AddItemState();
  }

  /// The detected item, after success.
  WardrobeItem? get uploadedItem => state.result?.item;

  static RejectReason _fromPreparation(PreparationError e) => switch (e) {
    PreparationError.tooSmall => RejectReason.tooSmall,
    PreparationError.tooLarge => RejectReason.tooLarge,
    PreparationError.unreadable => RejectReason.unreadable,
    PreparationError.orientation => RejectReason.orientation,
  };
}
