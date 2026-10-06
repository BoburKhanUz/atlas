import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../wardrobe/data/image_preparer.dart';
import '../../wardrobe/data/photo_picker.dart';
import '../../wardrobe/providers.dart' show imagePreparerProvider, photoPickerProvider;
import '../data/color_profile_repository.dart';
import '../providers.dart';

/// The selfie's longest side: the server analyses at 128×128, so 1024 px
/// is plenty — fewer bytes and less detail leave the device.
const selfieMaxSide = 1024;

enum SelfiePhase {
  /// Consent: shown BEFORE any camera/photo permission prompt.
  consent,
  picking,
  preparing,
  analysing,

  /// The server answered with the result of THIS analysis.
  done,

  /// The photo was refused (unreadable, too small, invalid image).
  rejected,

  /// The server answered with an error: nothing was analysed.
  failed,

  /// The answer was lost: it is not known whether this analysis ran. The
  /// server's current colour profile is read and shown as such.
  unknown,
}

@immutable
class SelfieAnalysisState {
  const SelfieAnalysisState({
    this.phase = SelfiePhase.consent,
    this.result,
    this.serverCurrent,
    this.failure,
    this.rejection,
    this.denied,
    this.hasImage = false,
  });

  final SelfiePhase phase;

  /// The analysis returned by the server for this attempt ([SelfiePhase.done]).
  final Analysed? result;

  /// After an unknown outcome: what the server has now (may be an older
  /// analysis — shown with its date, never claimed as this attempt).
  final ColorProfileState? serverCurrent;
  final ApiFailure? failure;
  final PreparationError? rejection;
  final PhotoSource? denied;

  /// A prepared selfie is held in memory (for an explicit retry).
  final bool hasImage;
}

/// Consent → camera/gallery → prepare (JPEG, EXIF/GPS stripped, ≤ 1024 px)
/// → ONE POST. The bytes live only in this controller (memory) and die with
/// the screen. Never retried automatically.
class SelfieAnalysisController extends Notifier<SelfieAnalysisState> {
  PreparedImage? _image;

  @override
  SelfieAnalysisState build() {
    ref.onDispose(() => _image = null);
    return const SelfieAnalysisState();
  }

  bool get _busy =>
      state.phase == SelfiePhase.picking ||
      state.phase == SelfiePhase.preparing ||
      state.phase == SelfiePhase.analysing;

  /// After consent: the system camera (front preferred) or the gallery.
  /// The permission prompt can only appear from here.
  Future<void> pick(PhotoSource source) async {
    if (_busy) return;
    state = const SelfieAnalysisState(phase: SelfiePhase.picking);
    final PickedPhoto? photo;
    try {
      photo = await ref.read(photoPickerProvider).pick(source, preferFront: source == PhotoSource.camera);
    } on PhotoAccessDenied catch (e) {
      if (!ref.mounted) return;
      state = SelfieAnalysisState(phase: SelfiePhase.consent, denied: e.source);
      return;
    }
    if (!ref.mounted) return;
    if (photo == null) {
      state = const SelfieAnalysisState(); // cancelled: back to the choice
      return;
    }
    state = const SelfieAnalysisState(phase: SelfiePhase.preparing);
    try {
      _image = await ref
          .read(imagePreparerProvider)
          .prepare(photo.bytes, originalName: 'selfie.jpg', maxSide: selfieMaxSide);
    } on ImagePreparationException catch (e) {
      if (!ref.mounted) return;
      _image = null;
      state = SelfieAnalysisState(phase: SelfiePhase.rejected, rejection: e.error);
      return;
    }
    if (!ref.mounted) return;
    await analyse();
  }

  /// ONE POST with the prepared selfie (also the explicit "try again").
  Future<void> analyse() async {
    final image = _image;
    if (image == null || state.phase == SelfiePhase.analysing) return;
    state = const SelfieAnalysisState(phase: SelfiePhase.analysing, hasImage: true);
    try {
      final result = await ref.read(colorProfileRepositoryProvider).analyze(image);
      if (!ref.mounted) return;
      _image = null; // done: the bytes are not kept
      ref.read(colorProfileProvider.notifier).replace(result);
      state = SelfieAnalysisState(phase: SelfiePhase.done, result: result);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('colour analysis: ${f.describe()}');
      if (f is ApiHttpFailure && f.statusCode == 422) {
        _image = null;
        state = SelfieAnalysisState(phase: SelfiePhase.rejected, failure: f);
      } else if (_definitelyNotAnalysed(f)) {
        state = SelfieAnalysisState(phase: SelfiePhase.failed, failure: f, hasImage: true);
      } else {
        await _check(f);
      }
    }
  }

  /// Unknown outcome: read the server's current colour profile ONCE.
  Future<void> _check(ApiFailure f) async {
    ColorProfileState? current;
    try {
      current = await ref.read(colorProfileRepositoryProvider).current();
      if (ref.mounted) ref.read(colorProfileProvider.notifier).replace(current);
    } on ApiFailure catch (e) {
      AppLog.info('colour profile check failed: ${e.describe()}');
    }
    if (!ref.mounted) return;
    state = SelfieAnalysisState(
      phase: SelfiePhase.unknown,
      serverCurrent: current,
      failure: f,
      hasImage: _image != null,
    );
  }

  /// Back to the start (a new photo).
  void restart() {
    if (_busy) return;
    _image = null;
    state = const SelfieAnalysisState();
  }

  /// ANALYSIS_UNAVAILABLE (503): the server analysed nothing and stored
  /// nothing — a definite failure that the same photo may retry.
  static bool _definitelyNotAnalysed(ApiFailure f) => switch (f) {
    ApiHttpFailure(code: ApiErrorCode.analysisUnavailable) => true,
    ApiHttpFailure(:final statusCode) => statusCode < 500,
    SessionEndedFailure() || InsecureConnectionFailure() || SecureStorageFailure() => true,
    _ => false,
  };
}
