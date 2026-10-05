import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import '../../core/session/providers.dart';
import 'data/image_preparer.dart';
import 'data/pending_upload_store.dart';
import 'data/photo_picker.dart';
import 'data/wardrobe_repository.dart';
import 'presentation/add_item_controller.dart';
import 'presentation/edit_item_controller.dart';
import 'presentation/wardrobe_list_controller.dart';

final wardrobeRepositoryProvider = Provider<WardrobeRepository>(
  (ref) => WardrobeRepository(ref.watch(atlasApiClientProvider)),
);

final photoPickerProvider = Provider<PhotoPicker>((ref) => PlatformPhotoPicker());

final imagePreparerProvider = Provider<ImagePreparer>((ref) => const ImagePreparer(PlatformImageCompressor()));

/// Waits used by the upload flow (IDEMPOTENCY_IN_PROGRESS); tests replace it.
final uploadSleepProvider = Provider<Future<void> Function(Duration)>((ref) => Future<void>.delayed);

final wardrobeListProvider = NotifierProvider<WardrobeListController, WardrobeListState>(WardrobeListController.new);

/// One add-item flow; disposed when its screen closes (bytes are dropped).
final addItemControllerProvider = NotifierProvider.autoDispose<AddItemController, AddItemState>(AddItemController.new);

/// Interrupted-upload records (secure storage, per user, no image data).
final pendingUploadStoreProvider = Provider<PendingUploadStore>(
  (ref) => PendingUploadStore(ref.watch(secureKeyValueStoreProvider)),
);

/// When this app process started (to tell a record left by an earlier run).
final processStartedAtProvider = Provider<DateTime>((ref) => DateTime.now().toUtc());

/// The latest server version of an edited item (published by the editor).
final wardrobeItemUpdatesProvider = NotifierProvider<WardrobeItemUpdates, WardrobeItem?>(WardrobeItemUpdates.new);

class WardrobeItemUpdates extends Notifier<WardrobeItem?> {
  @override
  WardrobeItem? build() => null;

  void publish(WardrobeItem item) => state = item;
}

/// One item, always read from the server (fresh signed URLs).
final wardrobeItemProvider = FutureProvider.autoDispose.family<WardrobeItem, String>(
  (ref, id) => ref.watch(wardrobeRepositoryProvider).get(id),
);

/// An upload left unfinished by an EARLIER run of the app (the bytes are
/// gone; only the duplicate-safe record remains). Null when there is none.
final interruptedUploadProvider = FutureProvider.autoDispose<PendingUpload?>((ref) async {
  final userId = ref.watch(authStateProvider.select((s) => s.user?.id));
  if (userId == null) return null;
  final record = await ref.watch(pendingUploadStoreProvider).read(userId);
  if (record == null || !record.createdAt.isBefore(ref.watch(processStartedAtProvider))) return null;
  return record;
});

/// The interrupted-upload notice was dismissed (this app session only).
final interruptedNoticeDismissedProvider = NotifierProvider<InterruptedNoticeDismissed, bool>(
  InterruptedNoticeDismissed.new,
);

class InterruptedNoticeDismissed extends Notifier<bool> {
  @override
  bool build() {
    ref.watch(authStateProvider.select((s) => s.user?.id));
    return false;
  }

  void dismiss() => state = true;
}

/// The attribute editor of one item; disposed with its screen (unsaved edits
/// never outlive it).
final editItemControllerProvider = NotifierProvider.autoDispose.family<EditItemController, EditState, String>(
  EditItemController.new,
);
