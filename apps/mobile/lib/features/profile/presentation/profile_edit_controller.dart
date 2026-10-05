import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../data/profile_data.dart';
import '../providers.dart';

enum ProfileEditStatus { loading, editing, saving, failed, saved, loadFailed }

@immutable
class ProfileEditState {
  const ProfileEditState({this.status = ProfileEditStatus.loading, this.original, this.draft, this.failure});
  final ProfileEditStatus status;

  /// The profile as the server last returned it.
  final ProfileData? original;

  /// Unsaved edits (kept after a failed save for an explicit retry).
  final ProfileDraft? draft;
  final ApiFailure? failure;

  bool get dirty => original != null && draft != null && draft!.patchFrom(original!) != null;

  ProfileEditState copyWith({
    ProfileEditStatus? status,
    ProfileData? original,
    ProfileDraft? draft,
    ApiFailure? failure,
  }) => ProfileEditState(
    status: status ?? this.status,
    original: original ?? this.original,
    draft: draft ?? this.draft,
    failure: failure,
  );
}

/// Name and style/colour preferences. Save = ONE PATCH with only the
/// changed fields (none → no request), then GET again so the screen shows
/// the server's truth. Never retried automatically.
class ProfileEditController extends Notifier<ProfileEditState> {
  @override
  ProfileEditState build() {
    Future.microtask(_load);
    return const ProfileEditState();
  }

  Future<void> _load() async {
    try {
      final p = await ref.read(accountProfileRepositoryProvider).get();
      if (!ref.mounted) return;
      state = ProfileEditState(status: ProfileEditStatus.editing, original: p, draft: p.toDraft());
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      state = ProfileEditState(status: ProfileEditStatus.loadFailed, failure: f);
    }
  }

  Future<void> retryLoad() async {
    if (state.status != ProfileEditStatus.loadFailed) return;
    state = const ProfileEditState();
    await _load();
  }

  void edit(ProfileDraft Function(ProfileDraft d) change) {
    final draft = state.draft;
    if (draft == null || state.status == ProfileEditStatus.saving) return;
    state = state.copyWith(status: ProfileEditStatus.editing, draft: change(draft));
  }

  /// Save (also the explicit Retry). Ignored while saving (double tap).
  Future<void> save() async {
    final original = state.original;
    final draft = state.draft;
    if (original == null || draft == null) return;
    if (state.status != ProfileEditStatus.editing && state.status != ProfileEditStatus.failed) return;
    if (draft.problem != null) return;
    final patch = draft.patchFrom(original);
    if (patch == null) {
      state = state.copyWith(status: ProfileEditStatus.saved); // nothing changed: no request
      return;
    }
    state = state.copyWith(status: ProfileEditStatus.saving);
    final repo = ref.read(accountProfileRepositoryProvider);
    try {
      await repo.update(patch);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('profile not saved: ${f.describe()}');
      if (f is SessionEndedFailure) {
        state = const ProfileEditState(status: ProfileEditStatus.loadFailed); // edits discarded; sign-in follows
        return;
      }
      state = state.copyWith(status: ProfileEditStatus.failed, failure: f);
      return;
    }
    // Server truth after the save (a failed read keeps the screen honest:
    // the profile tab reloads on its own).
    try {
      final fresh = await repo.get();
      if (!ref.mounted) return;
      ref.read(profileProvider.notifier).replace(fresh);
      state = ProfileEditState(status: ProfileEditStatus.saved, original: fresh, draft: fresh.toDraft());
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('profile not re-read after save: ${f.describe()}');
      ref.invalidate(profileProvider);
      state = state.copyWith(status: ProfileEditStatus.saved);
    }
  }
}
