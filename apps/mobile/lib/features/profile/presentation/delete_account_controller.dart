import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart' show PaintingBinding;

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../data/local_user_data.dart';
import '../providers.dart';

/// What the user must type to confirm.
const deleteConfirmationWord = 'O‘CHIRISH';

enum DeletePhase {
  idle,
  deleting,

  /// Confirmed (200, or 404 = already gone): local data cleared, signed out.
  deleted,

  /// The server answered with an error: nothing was deleted.
  failed,

  /// The answer was lost: the account may or may not be deleted. Only an
  /// explicit "Tekshirish" (DELETE again: 404 confirms) resolves it.
  unknown,
}

@immutable
class DeleteAccountState {
  const DeleteAccountState({this.phase = DeletePhase.idle, this.failure});
  final DeletePhase phase;
  final ApiFailure? failure;
}

/// DELETE /api/v1/account — immediate and irreversible. One request per
/// explicit action, never retried automatically; success is claimed only
/// after the server confirms (200 or 404).
class DeleteAccountController extends Notifier<DeleteAccountState> {
  @override
  DeleteAccountState build() => const DeleteAccountState();

  static bool confirmationMatches(String typed) => typed.trim().toUpperCase() == deleteConfirmationWord;

  /// The first delete (needs the typed confirmation) or "Tekshirish" after
  /// an unknown outcome.
  Future<void> delete({String typed = ''}) async {
    if (state.phase == DeletePhase.deleting || state.phase == DeletePhase.deleted) return;
    final checking = state.phase == DeletePhase.unknown;
    if (!checking && !confirmationMatches(typed)) return;
    final userId = ref.read(authStateProvider).user?.id;
    if (userId == null) return;
    state = const DeleteAccountState(phase: DeletePhase.deleting);
    try {
      await ref.read(accountRepositoryProvider).delete();
    } on ApiFailure catch (f) {
      AppLog.info('account deletion: ${f.describe()}');
      if (f is ApiHttpFailure && f.code == ApiErrorCode.notFound) {
        await _confirmed(userId); // already gone = deleted
        return;
      }
      if (f is SessionEndedFailure) {
        // The session cannot be renewed — after a lost answer this can mean
        // the deletion went through (it deletes every session). Nothing
        // is claimed and no local data is removed; the sign-in screen says
        // the account may have been deleted.
        ref.read(accountMaybeDeletedProvider.notifier).mark();
        if (ref.mounted) state = DeleteAccountState(phase: DeletePhase.unknown, failure: f);
        return;
      }
      if (!ref.mounted) return;
      final definite = f is ApiHttpFailure && f.statusCode < 500;
      state = DeleteAccountState(phase: definite ? DeletePhase.failed : DeletePhase.unknown, failure: f);
      return;
    }
    await _confirmed(userId);
  }

  /// Local clean-up of THIS user only, then sign-out without /auth/logout.
  Future<void> _confirmed(String userId) async {
    final kv = ref.read(secureKeyValueStoreProvider);
    final session = ref.read(sessionControllerProvider);
    await LocalUserData.clear(kv, userId);
    // Decoded images of this user's wardrobe/outfits (memory only).
    PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages();
    if (ref.mounted) state = const DeleteAccountState(phase: DeletePhase.deleted);
    await session.endAfterAccountDeletion();
  }
}
