import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/signed_image.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../data/analysis_review.dart';
import '../providers.dart';
import 'review_panel.dart';
import 'wardrobe_labels.dart';

/// Read-only item detail (editing detected attributes is Phase 3.6).
class ItemDetailScreen extends ConsumerStatefulWidget {
  const ItemDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends ConsumerState<ItemDetailScreen> {
  bool _deleting = false;

  /// "This is correct" for this screen visit only (never sent).
  final _acknowledged = <ItemAttribute>{};

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Kiyimni o‘chirasizmi?'),
        content: const Text('Kiyim va uning rasmlari butunlay o‘chiriladi. Buni qaytarib bo‘lmaydi.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Bekor qilish')),
          TextButton(
            key: const Key('item.confirmDelete'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('O‘chirish', style: TextStyle(color: AtlasColors.error)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(wardrobeRepositoryProvider).delete(widget.id);
    } on ApiFailure catch (f) {
      // Already gone on the server: the outcome the user wanted.
      final gone = f is ApiHttpFailure && f.code == ApiErrorCode.notFound;
      if (!gone) {
        if (mounted) setState(() => _deleting = false);
        messenger.showSnackBar(SnackBar(content: Text(f.userMessage)));
        return;
      }
    }
    ref.read(wardrobeListProvider.notifier).remove(widget.id);
    if (mounted) context.pop();
    messenger.showSnackBar(const SnackBar(content: Text('Kiyim o‘chirildi')));
  }

  @override
  Widget build(BuildContext context) {
    final item = ref.watch(wardrobeItemProvider(widget.id));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kiyim'),
        actions: [
          if (item.hasValue)
            IconButton(
              key: const Key('item.edit'),
              tooltip: 'Tuzatish',
              onPressed: _deleting ? null : () => context.push(AtlasRoutes.wardrobeItemEdit(widget.id)),
              icon: const Icon(Icons.edit_outlined),
            ),
          if (item.hasValue)
            IconButton(
              key: const Key('item.delete'),
              tooltip: 'O‘chirish',
              onPressed: _deleting ? null : _delete,
              icon: _deleting
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.delete_outline_rounded),
            ),
        ],
      ),
      body: switch (item) {
        AsyncData(:final value) => _Details(
          item: value,
          acknowledged: _acknowledged,
          onAcknowledge: (a) => setState(() => _acknowledged.add(a)),
          onEdit: () => context.push(AtlasRoutes.wardrobeItemEdit(widget.id)),
          onExpired: () => ref.invalidate(wardrobeItemProvider(widget.id)),
        ),
        AsyncError(error: NoNetworkFailure()) => OfflineStateView(
          onRetry: () => ref.invalidate(wardrobeItemProvider(widget.id)),
        ),
        AsyncError(error: ApiHttpFailure(code: ApiErrorCode.notFound)) => const EmptyStateView(
          icon: Icons.search_off_rounded,
          title: 'Kiyim topilmadi',
          message: 'U o‘chirilgan bo‘lishi mumkin.',
        ),
        AsyncError(:final error) => ErrorStateView(
          message: error is ApiFailure ? error.userMessage : 'Nimadir xato ketdi. Qayta urinib ko‘ring.',
          onRetry: () => ref.invalidate(wardrobeItemProvider(widget.id)),
        ),
        _ => const LoadingView(),
      },
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({
    required this.item,
    required this.acknowledged,
    required this.onAcknowledge,
    required this.onEdit,
    required this.onExpired,
  });
  final WardrobeItem item;
  final Set<ItemAttribute> acknowledged;
  final void Function(ItemAttribute) onAcknowledge;
  final VoidCallback onEdit;
  final VoidCallback onExpired;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final image = item.primaryImage ?? item.images.firstOrNull;
    return ListView(
      padding: const EdgeInsets.all(AtlasSpacing.screen),
      children: [
        if (image != null)
          ClipRRect(
            borderRadius: AtlasRadii.card,
            child: AspectRatio(
              aspectRatio: (image.width ?? 3) / (image.height ?? 4),
              child: SignedImage(
                image: SignedImageRef(imageId: image.id, url: image.url, expiresAt: image.urlExpiresAt),
                onExpired: onExpired,
                fit: BoxFit.contain,
                semanticLabel: 'Kiyim surati',
              ),
            ),
          ),
        const SizedBox(height: AtlasSpacing.lg),
        AttributeReviewList(item: item, acknowledged: acknowledged, onAcknowledge: onAcknowledge, onEdit: onEdit),
        if (item.wasCorrected) ...[
          const SizedBox(height: AtlasSpacing.md),
          Text('Siz tuzatgan maydonlar', style: text.titleSmall),
          const SizedBox(height: AtlasSpacing.xs),
          for (final c in item.correctionLog)
            Text(
              '${WardrobeLabels.field(c.field)}: ${c.from} → ${c.to}',
              key: const Key('item.correction'),
              style: text.bodyMedium,
            ),
        ],
      ],
    );
  }
}
