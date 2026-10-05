import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../data/profile_data.dart';
import '../providers.dart';

enum ProfileStatus { loading, ready, refreshing, failed }

@immutable
class ProfileViewState {
  const ProfileViewState({this.status = ProfileStatus.loading, this.profile, this.failure});
  final ProfileStatus status;
  final ProfileData? profile;

  /// A failed refresh keeps the profile on screen.
  final ApiFailure? failure;
}

class ProfileController extends Notifier<ProfileViewState> {
  @override
  ProfileViewState build() {
    ref.watch(authStateProvider.select((s) => s.user?.id));
    Future.microtask(_load);
    return const ProfileViewState();
  }

  Future<void> refresh() async {
    if (state.status == ProfileStatus.loading || state.status == ProfileStatus.refreshing) return;
    state = ProfileViewState(
      status: state.profile == null ? ProfileStatus.loading : ProfileStatus.refreshing,
      profile: state.profile,
    );
    await _load();
  }

  /// The server's answer after a save.
  void replace(ProfileData profile) => state = ProfileViewState(status: ProfileStatus.ready, profile: profile);

  Future<void> _load() async {
    try {
      final p = await ref.read(accountProfileRepositoryProvider).get();
      if (!ref.mounted) return;
      state = ProfileViewState(status: ProfileStatus.ready, profile: p);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('profile not loaded: ${f.describe()}');
      state = ProfileViewState(
        status: state.profile == null ? ProfileStatus.failed : ProfileStatus.ready,
        profile: state.profile,
        failure: f,
      );
    }
  }
}
