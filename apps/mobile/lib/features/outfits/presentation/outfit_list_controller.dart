import 'package:atlas_api/atlas_api.dart' show OutfitSummary;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../providers.dart';

enum OutfitListStatus { loading, ready, refreshing, failed }

@immutable
class OutfitListState {
  const OutfitListState({this.status = OutfitListStatus.loading, this.outfits = const [], this.failure});
  final OutfitListStatus status;
  final List<OutfitSummary> outfits;

  /// A failed refresh keeps the outfits on screen.
  final ApiFailure? failure;
}

/// Saved (`savedOnly`) or recent outfits: the last 50 (the contract has no
/// pagination). Reads use the shared safe-GET retry policy.
class OutfitListController extends Notifier<OutfitListState> {
  OutfitListController(this.savedOnly);
  final bool savedOnly;

  @override
  OutfitListState build() {
    Future.microtask(_load);
    return const OutfitListState();
  }

  Future<void> refresh() async {
    if (state.status == OutfitListStatus.loading || state.status == OutfitListStatus.refreshing) return;
    state = OutfitListState(
      status: state.outfits.isEmpty ? OutfitListStatus.loading : OutfitListStatus.refreshing,
      outfits: state.outfits,
    );
    await _load();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(outfitsRepositoryProvider).list(savedOnly: savedOnly);
      if (!ref.mounted) return;
      state = OutfitListState(status: OutfitListStatus.ready, outfits: list.outfits);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('outfits not loaded: ${f.describe()}');
      state = OutfitListState(
        status: state.outfits.isEmpty ? OutfitListStatus.failed : OutfitListStatus.ready,
        outfits: state.outfits,
        failure: f,
      );
    }
  }
}
