import 'package:atlas_api/atlas_api.dart' show ImageObject, WardrobeItem;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/signed_image.dart';
import '../../wardrobe/presentation/wardrobe_screen.dart' show thumbnailOf;
import '../../wardrobe/providers.dart';

/// Thumbnail reference of a stored image (`ImageObject`).
SignedImageRef thumbRefOf(ImageObject image) => SignedImageRef(
  imageId: image.id,
  url: image.thumbnailUrl ?? image.url,
  expiresAt: image.urlExpiresAt,
  variant: image.thumbnailUrl != null ? ImageVariant.thumbnail : ImageVariant.display,
);

/// The image of a GENERATED outfit item: the response only has a bare signed
/// `imageUrl` (no image id, no expiry). It is cached in memory under the
/// wardrobe item id + variant (never the URL). When the server rejects it
/// (expired, 403), the wardrobe item is reloaded for a fresh URL.
class GeneratedItemImage extends ConsumerStatefulWidget {
  const GeneratedItemImage({super.key, required this.itemId, required this.imageUrl, this.semanticLabel});
  final String itemId;
  final String? imageUrl;
  final String? semanticLabel;

  @override
  ConsumerState<GeneratedItemImage> createState() => _GeneratedItemImageState();
}

class _GeneratedItemImageState extends ConsumerState<GeneratedItemImage> {
  WardrobeItem? _fresh;
  bool _gone = false;
  bool _reloading = false;
  DateTime? _lastReload;

  Future<void> _reload() async {
    final last = _lastReload;
    if (_reloading || (last != null && DateTime.now().difference(last) < const Duration(seconds: 30))) return;
    _reloading = true;
    _lastReload = DateTime.now();
    try {
      final item = await ref.read(wardrobeRepositoryProvider).get(widget.itemId);
      if (mounted) setState(() => _fresh = item);
    } on ApiFailure catch (f) {
      AppLog.info('outfit item image not refreshed: ${f.describe()}');
      if (mounted && f is ApiHttpFailure && f.statusCode == 404) setState(() => _gone = true);
    } finally {
      _reloading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_gone) return const _NoImage();
    final fresh = _fresh;
    final SignedImageRef? image;
    if (fresh != null) {
      image = thumbnailOf(fresh);
    } else {
      final url = widget.imageUrl;
      image = url == null
          ? null
          : SignedImageRef(
              imageId: 'item:${widget.itemId}',
              url: url,
              expiresAt: null,
              variant: ImageVariant.thumbnail,
            );
    }
    if (image == null) return const _NoImage();
    return SignedImage(image: image, onExpired: _reload, semanticLabel: widget.semanticLabel);
  }
}

class _NoImage extends StatelessWidget {
  const _NoImage();

  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: AtlasColors.skeleton,
    child: Center(child: Icon(Icons.checkroom_outlined, color: AtlasColors.textSecondary)),
  );
}

/// A stored image (lists, detail) with the owner's reload on expiry.
class StoredItemImage extends StatelessWidget {
  const StoredItemImage({super.key, required this.image, required this.onExpired, this.semanticLabel});
  final ImageObject? image;
  final VoidCallback onExpired;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final image = this.image;
    if (image == null) return const _NoImage();
    return SignedImage(image: thumbRefOf(image), onExpired: onExpired, semanticLabel: semanticLabel);
  }
}
