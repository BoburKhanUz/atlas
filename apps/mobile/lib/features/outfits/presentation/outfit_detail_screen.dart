import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../wardrobe/presentation/wardrobe_labels.dart';
import '../data/generated_outfits.dart';
import '../providers.dart';
import 'outfit_detail_controller.dart';
import 'outfit_images.dart';
import 'outfit_labels.dart';

/// A stored outfit: items, reasons, weather it was made for; rename,
/// save/unsave and delete.
class OutfitDetailScreen extends ConsumerWidget {
  const OutfitDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = outfitDetailControllerProvider(id);
    final s = ref.watch(provider);
    final c = ref.read(provider.notifier);
    ref.listen(provider.select((x) => (x.status, x.failure)), (prev, next) {
      final messenger = ScaffoldMessenger.of(context);
      if (next.$1 == OutfitDetailStatus.deleted) {
        messenger.showSnackBar(const SnackBar(content: Text('Obraz o‘chirildi')));
        if (context.canPop()) context.pop();
      } else if (next.$1 == OutfitDetailStatus.notFound) {
        messenger.showSnackBar(const SnackBar(content: Text('Obraz topilmadi — u o‘chirilgan.')));
        if (context.canPop()) context.pop();
      } else if (next.$1 == OutfitDetailStatus.ready && next.$2 != null && next.$2 != prev?.$2) {
        messenger.showSnackBar(SnackBar(content: Text(next.$2!.userMessage)));
      }
    });
    final outfit = s.outfit;
    final running = s.running;
    final text = Theme.of(context).textTheme;

    final Widget body;
    if (s.status == OutfitDetailStatus.loading) {
      body = const LoadingView();
    } else if (outfit == null) {
      body = s.failure is NoNetworkFailure
          ? OfflineStateView(onRetry: c.reload)
          : ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.reload);
    } else {
      final weather = OutfitLabels.snapshot(outfit.weatherSnapshot);
      body = ListView(
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        children: [
          Text(outfit.name ?? 'Nomsiz obraz', key: const Key('outfitDetail.name'), style: text.headlineSmall),
          Text(
            [
              if (outfit.occasion != null) OutfitLabels.occasion(outfit.occasion!),
              ?weather,
              if (outfit.score != null) 'Moslik ${outfit.score}%',
            ].join(' · '),
            style: text.bodyMedium,
          ),
          const SizedBox(height: AtlasSpacing.md),
          for (final i in outfit.items)
            Padding(
              padding: const EdgeInsets.only(bottom: AtlasSpacing.sm),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: AtlasRadii.field,
                    child: SizedBox.square(
                      dimension: 72,
                      child: StoredItemImage(
                        image: i.item.images.where((im) => im.isPrimary).firstOrNull ?? i.item.images.firstOrNull,
                        onExpired: c.reload,
                      ),
                    ),
                  ),
                  const SizedBox(width: AtlasSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          WardrobeLabels.subcategory(i.item.subcategory.text ?? i.item.category),
                          style: text.titleSmall,
                        ),
                        Text(
                          [
                            OutfitLabels.role(i.role.text),
                            i.item.colors.map(WardrobeLabels.color).join(', '),
                          ].where((x) => x.isNotEmpty).join(' · '),
                          style: text.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (outfit.reasons.isNotEmpty) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Text('Nega mos?', style: text.titleSmall),
            for (final r in outfit.reasons) Text('• $r', style: text.bodyMedium),
          ],
          if (outfit.explanation != null) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Text(outfit.explanation!, style: text.bodyMedium),
          ],
          const SizedBox(height: AtlasSpacing.lg),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            children: [
              FilledButton.tonalIcon(
                key: const Key('outfitDetail.toggleSave'),
                onPressed: running != null ? null : () => c.setSaved(saved: !outfit.isSaved),
                icon: Icon(outfit.isSaved ? Icons.bookmark_remove_outlined : Icons.bookmark_add_outlined),
                label: Text(outfit.isSaved ? 'Saqlanganlardan olish' : 'Saqlash'),
              ),
              OutlinedButton.icon(
                key: const Key('outfitDetail.rename'),
                onPressed: running != null ? null : () => _rename(context, c, outfit.name),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('Nomlash'),
              ),
              TextButton.icon(
                key: const Key('outfitDetail.delete'),
                onPressed: running != null ? null : () => _delete(context, c),
                icon: const Icon(Icons.delete_outline_rounded, color: AtlasColors.error),
                label: const Text('O‘chirish', style: TextStyle(color: AtlasColors.error)),
              ),
            ],
          ),
        ],
      );
    }
    return PopScope(
      canPop: running == null,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Obraz'),
          bottom: running == null
              ? null
              : const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)),
        ),
        body: SafeArea(child: body),
      ),
    );
  }

  Future<void> _rename(BuildContext context, OutfitDetailController c, String? current) async {
    final name = await showDialog<String>(
      context: context,
      builder: (_) => _RenameDialog(initial: current ?? ''),
    );
    if (name != null) await c.rename(name);
  }

  Future<void> _delete(BuildContext context, OutfitDetailController c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Obrazni o‘chirasizmi?'),
        content: const Text('Kiyimlaringiz garderobda qoladi; faqat shu obraz o‘chadi.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Bekor qilish')),
          TextButton(
            key: const Key('outfitDetail.confirmDelete'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('O‘chirish', style: TextStyle(color: AtlasColors.error)),
          ),
        ],
      ),
    );
    if (ok == true) await c.delete();
  }
}

class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.initial});
  final String initial;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final _text = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final valid = OutfitName.valid(_text.text) != null;
    return AlertDialog(
      title: const Text('Obraz nomi'),
      content: TextField(
        key: const Key('outfitDetail.nameField'),
        controller: _text,
        autofocus: true,
        maxLength: OutfitName.maxLength,
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(hintText: 'Masalan: Juma kuni ofis'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Bekor qilish')),
        TextButton(
          key: const Key('outfitDetail.nameSave'),
          onPressed: valid ? () => Navigator.pop(context, _text.text) : null,
          child: const Text('Saqlash'),
        ),
      ],
    );
  }
}
