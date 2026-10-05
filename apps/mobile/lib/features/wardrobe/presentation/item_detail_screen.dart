import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/signed_image.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../providers.dart';
import 'wardrobe_labels.dart';

/// One item, always read from the server (fresh signed URLs).
final wardrobeItemProvider = FutureProvider.autoDispose.family<WardrobeItem, String>(
  (ref, id) => ref.watch(wardrobeRepositoryProvider).get(id),
);

/// Read-only item detail (editing detected attributes is Phase 3.6).
class ItemDetailScreen extends ConsumerStatefulWidget {
  const ItemDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends ConsumerState<ItemDetailScreen> {
  bool _deleting = false;

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
  const _Details({required this.item, required this.onExpired});
  final WardrobeItem item;
  final VoidCallback onExpired;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final image = item.primaryImage ?? item.images.firstOrNull;
    final rows = <(String, String)>[
      ('Toifa', WardrobeLabels.category(item.category)),
      if (item.subcategory != null) ('Tur', WardrobeLabels.subcategory(item.subcategory!)),
      if (item.colors.isNotEmpty) ('Ranglar', item.colors.map(WardrobeLabels.color).join(', ')),
      if (item.pattern != null) ('Naqsh', WardrobeLabels.pattern(item.pattern!)),
      if (item.material != null) ('Material', WardrobeLabels.material(item.material!)),
      if (item.sleeveLength != null) ('Yeng', WardrobeLabels.sleeve(item.sleeveLength!)),
      if (item.fit != null) ('Bichim', WardrobeLabels.fit(item.fit!)),
      if (item.style != null) ('Uslub', WardrobeLabels.style(item.style!)),
      if (item.formality != null) ('Rasmiylik', WardrobeLabels.formality(item.formality!)),
      if (item.season.isNotEmpty) ('Mavsum', item.season.map(WardrobeLabels.season).join(', ')),
      if (item.gender != null) ('Kim uchun', WardrobeLabels.gender(item.gender!)),
    ];
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
        for (final (label, value) in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AtlasSpacing.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 110, child: Text(label, style: text.bodyMedium)),
                Expanded(child: Text(value, style: text.bodyLarge)),
              ],
            ),
          ),
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
