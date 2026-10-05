import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import '../../core/session/auth_state.dart';
import '../../core/session/providers.dart';
import 'data/account_repository.dart';
import 'data/color_profile_repository.dart';
import 'data/profile_repository.dart';
import 'presentation/color_profile_controller.dart';
import 'presentation/delete_account_controller.dart';
import 'presentation/profile_controller.dart';
import 'presentation/profile_edit_controller.dart';
import 'presentation/selfie_analysis_controller.dart';

final accountProfileRepositoryProvider = Provider<AccountProfileRepository>(
  (ref) => AccountProfileRepository(ref.watch(atlasApiClientProvider)),
);
final colorProfileRepositoryProvider = Provider<ColorProfileRepository>(
  (ref) => ColorProfileRepository(ref.watch(atlasApiClientProvider)),
);
final accountRepositoryProvider = Provider<AccountRepository>(
  (ref) => AccountRepository(ref.watch(atlasApiClientProvider)),
);

/// The signed-in user's profile (rebuilt per user).
final profileProvider = NotifierProvider<ProfileController, ProfileViewState>(ProfileController.new);

final profileEditControllerProvider = NotifierProvider.autoDispose<ProfileEditController, ProfileEditState>(
  ProfileEditController.new,
);

/// The server's current colour profile (rebuilt per user).
final colorProfileProvider = NotifierProvider<ColorProfileController, ColorProfileViewState>(
  ColorProfileController.new,
);

/// One selfie analysis flow (the bytes live only in this controller and die
/// with its screen).
final selfieAnalysisControllerProvider = NotifierProvider.autoDispose<SelfieAnalysisController, SelfieAnalysisState>(
  SelfieAnalysisController.new,
);

final deleteAccountControllerProvider = NotifierProvider.autoDispose<DeleteAccountController, DeleteAccountState>(
  DeleteAccountController.new,
);

/// Set when the session ended while an account deletion could not be
/// confirmed: the sign-in screen then says the account may have been
/// deleted. In memory only; cleared on the next sign-in.
final accountMaybeDeletedProvider = NotifierProvider<AccountMaybeDeleted, bool>(AccountMaybeDeleted.new);

class AccountMaybeDeleted extends Notifier<bool> {
  @override
  bool build() {
    ref.listen(authStateProvider, (_, next) {
      if (next is Authenticated) state = false;
    });
    return false;
  }

  void mark() => state = true;
}
