import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import 'data/image_preparer.dart';
import 'data/photo_picker.dart';
import 'data/wardrobe_repository.dart';
import 'presentation/add_item_controller.dart';
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
