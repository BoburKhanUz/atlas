import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import 'data/outfits_repository.dart';
import 'presentation/generate_controller.dart';
import 'presentation/outfit_detail_controller.dart';
import 'presentation/outfit_list_controller.dart';

final outfitsRepositoryProvider = Provider<OutfitsRepository>(
  (ref) => OutfitsRepository(ref.watch(atlasApiClientProvider)),
);

/// The seed of a generation ("Boshqa variant" = a new seed).
final outfitSeedProvider = Provider<int Function()>(
  (ref) =>
      () => DateTime.now().millisecondsSinceEpoch,
);

/// Suggestions, the chosen occasion and per-candidate save/feedback state
/// (rebuilt per user).
final generateControllerProvider = NotifierProvider<GenerateController, GenerateState>(GenerateController.new);

/// Saved (true) or recent (false) outfits.
final outfitListProvider = NotifierProvider.autoDispose.family<OutfitListController, OutfitListState, bool>(
  OutfitListController.new,
);

final outfitDetailControllerProvider = NotifierProvider.autoDispose
    .family<OutfitDetailController, OutfitDetailState, String>(OutfitDetailController.new);

enum OutfitsTab { suggest, saved, recent }

/// The visible section of the Outfits tab.
final outfitsTabProvider = NotifierProvider<OutfitsTabController, OutfitsTab>(OutfitsTabController.new);

class OutfitsTabController extends Notifier<OutfitsTab> {
  @override
  OutfitsTab build() => OutfitsTab.suggest;

  void show(OutfitsTab tab) => state = tab;
}
