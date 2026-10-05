import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../data/color_profile_repository.dart';
import '../providers.dart';

enum ColorProfileStatus { loading, ready, refreshing, failed }

@immutable
class ColorProfileViewState {
  const ColorProfileViewState({this.status = ColorProfileStatus.loading, this.current, this.failure});
  final ColorProfileStatus status;

  /// The server's current colour profile (not analysed / analysed).
  final ColorProfileState? current;
  final ApiFailure? failure;
}

class ColorProfileController extends Notifier<ColorProfileViewState> {
  @override
  ColorProfileViewState build() {
    ref.watch(authStateProvider.select((s) => s.user?.id));
    Future.microtask(_load);
    return const ColorProfileViewState();
  }

  Future<void> refresh() async {
    if (state.status == ColorProfileStatus.loading || state.status == ColorProfileStatus.refreshing) return;
    state = ColorProfileViewState(
      status: state.current == null ? ColorProfileStatus.loading : ColorProfileStatus.refreshing,
      current: state.current,
    );
    await _load();
  }

  /// The server's current state (after an analysis or a check).
  void replace(ColorProfileState current) =>
      state = ColorProfileViewState(status: ColorProfileStatus.ready, current: current);

  Future<void> _load() async {
    try {
      final c = await ref.read(colorProfileRepositoryProvider).current();
      if (!ref.mounted) return;
      state = ColorProfileViewState(status: ColorProfileStatus.ready, current: c);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('colour profile not loaded: ${f.describe()}');
      state = ColorProfileViewState(
        status: state.current == null ? ColorProfileStatus.failed : ColorProfileStatus.ready,
        current: state.current,
        failure: f,
      );
    }
  }
}
