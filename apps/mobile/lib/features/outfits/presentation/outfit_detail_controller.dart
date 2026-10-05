import 'package:atlas_api/atlas_api.dart' show OutfitDetail, OutfitRow;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../data/outfits_repository.dart';
import '../providers.dart';

enum OutfitDetailStatus { loading, ready, notFound, loadFailed, deleted }

enum OutfitAction { rename, save, unsave, delete }

/// Rename: 1–80 characters after trimming (the contract allows 80; an empty
/// name cannot be sent because null fields are omitted).
abstract final class OutfitName {
  static const maxLength = 80;

  static String? valid(String input) {
    final name = input.trim();
    return name.isEmpty || name.length > maxLength ? null : name;
  }
}

@immutable
class OutfitDetailState {
  const OutfitDetailState({this.status = OutfitDetailStatus.loading, this.outfit, this.running, this.failure});
  final OutfitDetailStatus status;
  final OutfitDetail? outfit;

  /// The action in flight (others are ignored meanwhile).
  final OutfitAction? running;
  final ApiFailure? failure;

  OutfitDetailState copyWith({
    OutfitDetailStatus? status,
    OutfitDetail? outfit,
    OutfitAction? Function()? running,
    ApiFailure? Function()? failure,
  }) => OutfitDetailState(
    status: status ?? this.status,
    outfit: outfit ?? this.outfit,
    running: running == null ? this.running : running(),
    failure: failure == null ? this.failure : failure(),
  );
}

/// One stored outfit: rename, save/unsave (PATCH `isSaved`) and delete. One
/// request per action, never retried automatically; 404 → gone.
class OutfitDetailController extends Notifier<OutfitDetailState> {
  OutfitDetailController(this.id);
  final String id;

  @override
  OutfitDetailState build() {
    Future.microtask(_load);
    return const OutfitDetailState();
  }

  Future<void> reload() async {
    if (state.running != null) return;
    if (state.outfit == null) state = const OutfitDetailState();
    await _load();
  }

  Future<void> _load() async {
    try {
      final outfit = await ref.read(outfitsRepositoryProvider).get(id);
      if (!ref.mounted) return;
      state = OutfitDetailState(status: OutfitDetailStatus.ready, outfit: outfit);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      if (_gone(f)) return _markGone(f);
      state = state.copyWith(
        status: state.outfit == null ? OutfitDetailStatus.loadFailed : OutfitDetailStatus.ready,
        failure: () => f,
      );
    }
  }

  /// False when [name] is not valid (nothing is sent).
  Future<bool> rename(String name) async {
    final valid = OutfitName.valid(name);
    if (valid == null) return false;
    if (valid == state.outfit?.name) return true;
    await _run(OutfitAction.rename, (repo) => repo.rename(id, valid));
    return true;
  }

  Future<void> setSaved({required bool saved}) =>
      _run(saved ? OutfitAction.save : OutfitAction.unsave, (repo) => repo.setSaved(id, saved: saved));

  Future<void> delete() async {
    final outfit = state.outfit;
    if (outfit == null || state.running != null) return;
    state = state.copyWith(running: () => OutfitAction.delete, failure: () => null);
    try {
      await ref.read(outfitsRepositoryProvider).delete(id);
      if (!ref.mounted) return;
      ref.invalidate(outfitListProvider);
      state = state.copyWith(status: OutfitDetailStatus.deleted, running: () => null);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      if (_gone(f)) {
        // Already gone: the outcome the user wanted.
        ref.invalidate(outfitListProvider);
        state = state.copyWith(status: OutfitDetailStatus.deleted, running: () => null);
        return;
      }
      state = state.copyWith(running: () => null, failure: () => f);
    }
  }

  Future<void> _run(OutfitAction action, Future<OutfitRow> Function(OutfitsRepository repo) call) async {
    final outfit = state.outfit;
    if (outfit == null || state.running != null) return;
    state = state.copyWith(running: () => action, failure: () => null);
    try {
      final row = await call(ref.read(outfitsRepositoryProvider));
      if (!ref.mounted) return;
      ref.invalidate(outfitListProvider);
      state = OutfitDetailState(
        status: OutfitDetailStatus.ready,
        outfit: outfit.rebuild(
          (b) => b
            ..name = row.name
            ..isSaved = row.isSaved
            ..updatedAt = row.updatedAt,
        ),
      );
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('outfit ${action.name} failed: ${f.describe()}');
      if (_gone(f)) return _markGone(f);
      state = state.copyWith(running: () => null, failure: () => f);
    }
  }

  static bool _gone(ApiFailure f) => f is ApiHttpFailure && f.code == ApiErrorCode.notFound;

  void _markGone(ApiFailure f) {
    ref.invalidate(outfitListProvider);
    state = state.copyWith(status: OutfitDetailStatus.notFound, running: () => null, failure: () => f);
  }
}
