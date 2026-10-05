import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show OutfitGenerateResponseOutfitsInner, OutfitSaveRequest;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../../weather/providers.dart';
import '../data/generated_outfits.dart';
import '../data/outfits_repository.dart';
import '../data/save_check.dart';
import '../providers.dart';

enum GeneratePhase { idle, generating, ready, failed }

/// Save state of one candidate (generated candidates are not stored until
/// they are saved).
enum SaveStatus {
  none,
  saving,

  /// Stored on the server (`outfitId` is set).
  saved,

  /// The answer was lost; the app is reading the list once to find out.
  checking,

  /// It cannot be told whether the server stored it. Never re-sent
  /// automatically; the user can check again or look at Saved outfits.
  unknown,

  /// The server answered with an error: nothing was stored.
  failed,
}

@immutable
class CandidateState {
  const CandidateState({
    this.outfitId,
    this.isSaved = false,
    this.save = SaveStatus.none,
    this.feedback,
    this.sendingFeedback = false,
    this.feedbackFailed = false,
    this.failure,
    this.pending,
  });

  /// The stored outfit (a save with `isSaved: false` happens first when
  /// feedback is given on a candidate that was never saved).
  final String? outfitId;
  final bool isSaved;
  final SaveStatus save;
  final OutfitFeedback? feedback;
  final bool sendingFeedback;
  final bool feedbackFailed;
  final ApiFailure? failure;

  /// The request whose outcome is unknown (for the check).
  final PendingSave? pending;

  bool get busy => save == SaveStatus.saving || save == SaveStatus.checking || sendingFeedback;

  CandidateState copyWith({
    String? outfitId,
    bool? isSaved,
    SaveStatus? save,
    OutfitFeedback? feedback,
    bool? sendingFeedback,
    bool? feedbackFailed,
    ApiFailure? Function()? failure,
    PendingSave? Function()? pending,
  }) => CandidateState(
    outfitId: outfitId ?? this.outfitId,
    isSaved: isSaved ?? this.isSaved,
    save: save ?? this.save,
    feedback: feedback ?? this.feedback,
    sendingFeedback: sendingFeedback ?? this.sendingFeedback,
    feedbackFailed: feedbackFailed ?? this.feedbackFailed,
    failure: failure == null ? this.failure : failure(),
    pending: pending == null ? this.pending : pending(),
  );
}

/// A POST /outfits whose answer was lost.
@immutable
class PendingSave {
  const PendingSave(this.request, this.attempt);
  final OutfitSaveRequest request;
  final Stopwatch attempt;
}

@immutable
class GenerateState {
  const GenerateState({
    this.phase = GeneratePhase.idle,
    this.occasion,
    this.result,
    this.failure,
    this.candidates = const {},
  });

  final GeneratePhase phase;

  /// The chosen occasion (kept across failures); null = any.
  final String? occasion;
  final GeneratedOutfits? result;
  final ApiFailure? failure;

  /// By `tempId`.
  final Map<String, CandidateState> candidates;

  CandidateState candidate(String tempId) => candidates[tempId] ?? const CandidateState();

  GenerateState copyWith({
    GeneratePhase? phase,
    String? Function()? occasion,
    GeneratedOutfits? Function()? result,
    ApiFailure? Function()? failure,
    Map<String, CandidateState>? candidates,
  }) => GenerateState(
    phase: phase ?? this.phase,
    occasion: occasion == null ? this.occasion : occasion(),
    result: result == null ? this.result : result(),
    failure: failure == null ? this.failure : failure(),
    candidates: candidates ?? this.candidates,
  );
}

/// Generation and the actions on its candidates. The backend makes the
/// suggestions; nothing is scored here. Generation, save and feedback are
/// never retried automatically, and each tap is one request at most.
class GenerateController extends Notifier<GenerateState> {
  OutfitsRepository get _repo => ref.read(outfitsRepositoryProvider);

  @override
  GenerateState build() {
    ref.watch(authStateProvider.select((s) => s.user?.id));
    return const GenerateState();
  }

  void chooseOccasion(String? occasion) {
    if (state.phase == GeneratePhase.generating) return;
    state = state.copyWith(occasion: () => occasion);
  }

  /// Generate (also "Boshqa variant": always a new seed).
  Future<void> generate() async {
    if (state.phase == GeneratePhase.generating) return;
    state = state.copyWith(phase: GeneratePhase.generating, failure: () => null);
    final weather = ref.read(weatherControllerProvider.notifier);
    if (weather.freshWeather == null) await weather.locate();
    if (!ref.mounted) return;
    final current = weather.freshWeather;
    try {
      final result = await _repo.generate(
        occasion: state.occasion,
        weather: current == null ? null : fieldsOfCurrent(current),
        location: weather.location, // sent only when there is no weather object
        seed: ref.read(outfitSeedProvider)(),
      );
      if (!ref.mounted) return;
      state = state.copyWith(phase: GeneratePhase.ready, result: () => result, candidates: const {});
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('outfits not generated: ${f.describe()}');
      if (f is SessionEndedFailure) {
        state = const GenerateState(); // sign-in follows
        return;
      }
      state = state.copyWith(phase: GeneratePhase.failed, failure: () => f);
    }
  }

  OutfitGenerateResponseOutfitsInner? _find(String tempId) =>
      state.result?.outfits.where((o) => o.tempId == tempId).firstOrNull;

  void _put(String tempId, CandidateState c) {
    if (!ref.mounted) return;
    state = state.copyWith(candidates: {...state.candidates, tempId: c});
  }

  /// "Saqlash": one POST (or, for a candidate already stored by feedback,
  /// one PATCH `isSaved: true`).
  Future<void> save(String tempId) async {
    final candidate = _find(tempId);
    final c = state.candidate(tempId);
    if (candidate == null || c.busy || c.isSaved || c.save == SaveStatus.unknown) return;
    final id = c.outfitId;
    if (id != null) {
      _put(tempId, c.copyWith(save: SaveStatus.saving, failure: () => null));
      try {
        await _repo.setSaved(id, saved: true);
        _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.saved, isSaved: true));
        ref.invalidate(outfitListProvider);
      } on ApiFailure catch (f) {
        _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.failed, failure: () => f));
      }
      return;
    }
    await _store(tempId, candidate, isSaved: true);
  }

  /// A second, explicit save after an unknown outcome: a NEW action that may
  /// create another record (the UI says so).
  Future<void> saveAgain(String tempId) async {
    final candidate = _find(tempId);
    final c = state.candidate(tempId);
    if (candidate == null || c.busy || c.save != SaveStatus.unknown) return;
    _put(tempId, const CandidateState());
    await _store(tempId, candidate, isSaved: c.pending?.request.isSaved ?? true);
  }

  /// Like / dislike. A candidate that is not stored yet is stored first
  /// (`isSaved: false`); feedback is sent only with a stored outfit id.
  Future<void> feedback(String tempId, OutfitFeedback kind) async {
    final candidate = _find(tempId);
    var c = state.candidate(tempId);
    if (candidate == null || c.busy || c.save == SaveStatus.unknown) return;
    if (c.outfitId == null) {
      final stored = await _store(tempId, candidate, isSaved: false);
      if (!stored) return;
      c = state.candidate(tempId);
    }
    final id = c.outfitId!;
    _put(tempId, c.copyWith(sendingFeedback: true, feedbackFailed: false, failure: () => null));
    try {
      await _repo.feedback(id, kind);
      _put(tempId, state.candidate(tempId).copyWith(sendingFeedback: false, feedback: kind));
    } on ApiFailure catch (f) {
      AppLog.info('feedback not sent: ${f.describe()}');
      _put(tempId, state.candidate(tempId).copyWith(sendingFeedback: false, feedbackFailed: true, failure: () => f));
    }
  }

  /// "Qayta tekshirish" for an unknown save: reads the list again.
  Future<void> recheck(String tempId) async {
    final c = state.candidate(tempId);
    final pending = c.pending;
    if (c.save != SaveStatus.unknown || pending == null) return;
    await _check(tempId, pending);
  }

  /// One POST /outfits. True when the outfit is (confirmed) stored.
  Future<bool> _store(String tempId, OutfitGenerateResponseOutfitsInner candidate, {required bool isSaved}) async {
    final request = saveRequestFor(
      candidate,
      occasion: state.result?.occasion,
      weatherUsed: state.result?.weatherUsed,
      isSaved: isSaved,
    );
    _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.saving, failure: () => null));
    final attempt = Stopwatch()..start();
    try {
      final id = await _repo.save(request);
      _stored(tempId, id, isSaved: isSaved);
      return true;
    } on ApiFailure catch (f) {
      AppLog.info('outfit save: ${f.describe()}');
      if (_definitelyNotStored(f)) {
        _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.failed, failure: () => f));
        return false;
      }
      // The server may have stored it: never claim failure, never re-send.
      return _check(tempId, PendingSave(request, attempt));
    }
  }

  void _stored(String tempId, String id, {required bool isSaved}) {
    _put(
      tempId,
      state
          .candidate(tempId)
          .copyWith(
            outfitId: id,
            isSaved: isSaved,
            save: isSaved ? SaveStatus.saved : SaveStatus.none,
            pending: () => null,
            failure: () => null,
          ),
    );
    ref.invalidate(outfitListProvider);
  }

  Future<bool> _check(String tempId, PendingSave pending) async {
    _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.checking, pending: () => pending));
    String? id;
    try {
      final list = await _repo.list(savedOnly: pending.request.isSaved ?? false);
      id = SaveCheck.confirmedId(
        sent: pending.request,
        outfits: list.outfits,
        serverNow: list.serverDate,
        sinceAttempt: pending.attempt.elapsed,
        knownIds: {for (final c in state.candidates.values) ?c.outfitId},
      );
    } on ApiFailure catch (f) {
      AppLog.info('save check failed: ${f.describe()}');
    }
    if (!ref.mounted) return false;
    if (id == null) {
      _put(tempId, state.candidate(tempId).copyWith(save: SaveStatus.unknown));
      return false;
    }
    _stored(tempId, id, isSaved: pending.request.isSaved ?? false);
    return true;
  }

  /// The server answered and stored nothing (or the request never left).
  static bool _definitelyNotStored(ApiFailure f) => switch (f) {
    ApiHttpFailure(:final statusCode) => statusCode < 500,
    SessionEndedFailure() || InsecureConnectionFailure() || SecureStorageFailure() => true,
    _ => false,
  };
}
