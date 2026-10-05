import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/signed_image.dart';
import '../../../core/widgets/skeleton.dart';
import '../../../core/widgets/state_views.dart';
import '../data/wardrobe_repository.dart';
import '../providers.dart';
import 'wardrobe_labels.dart';
import 'wardrobe_list_controller.dart';

/// Thumbnail reference of an item (the 400 px rendition when there is one).
SignedImageRef? thumbnailOf(WardrobeItem item) {
  final image = item.primaryImage ?? item.images.firstOrNull;
  if (image == null) return null;
  final thumb = image.thumbnailUrl;
  return SignedImageRef(
    imageId: image.id,
    url: thumb ?? image.url,
    expiresAt: image.urlExpiresAt,
    variant: thumb != null ? ImageVariant.thumbnail : ImageVariant.display,
  );
}

class WardrobeScreen extends ConsumerWidget {
  const WardrobeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(wardrobeListProvider);
    final list = ref.read(wardrobeListProvider.notifier);
    void add() => context.push(AtlasRoutes.wardrobeAdd);

    final Widget? body = switch (s) {
      WardrobeListState(status: ListStatus.loading) => const LoadingView(),
      WardrobeListState(failure: NoNetworkFailure()) => OfflineStateView(onRetry: list.refresh),
      WardrobeListState(:final failure?) => ErrorStateView(message: failure.userMessage, onRetry: list.refresh),
      WardrobeListState(items: []) => EmptyStateView(
        icon: Icons.checkroom_outlined,
        title: s.category == 'all' ? 'Garderob bo‘sh' : 'Bu toifada kiyim yo‘q',
        message: 'Kiyimingizni suratga oling — ATLAS uni tahlil qilib, garderobingizga qo‘shadi.',
        actionLabel: 'Kiyim qo‘shish',
        onAction: add,
      ),
      _ => null,
    };

    return AtlasPage(
      title: 'Garderob',
      onRefresh: list.refresh,
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('wardrobe.add'),
        onPressed: add,
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text('Qo‘shish'),
      ),
      slivers: [
        SliverToBoxAdapter(
          child: _CategoryChips(selected: s.category, onSelected: list.setCategory),
        ),
        if (body != null)
          SliverFillRemaining(hasScrollBody: false, child: SizedBox(height: 420, child: body))
        else ...[
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(AtlasSpacing.screen, AtlasSpacing.sm, AtlasSpacing.screen, 0),
            sliver: SliverGrid.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 220,
                mainAxisSpacing: AtlasSpacing.sm,
                crossAxisSpacing: AtlasSpacing.sm,
                childAspectRatio: 0.72,
              ),
              itemCount: s.items.length,
              itemBuilder: (context, i) {
                if (i >= s.items.length - 6) WidgetsBinding.instance.addPostFrameCallback((_) => list.loadMore());
                return _ItemTile(item: s.items[i], onExpired: list.refresh);
              },
            ),
          ),
          SliverToBoxAdapter(
            child: _Footer(state: s, onRetry: list.loadMore),
          ),
        ],
      ],
    );
  }
}

class _CategoryChips extends StatelessWidget {
  const _CategoryChips({required this.selected, required this.onSelected});
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen, vertical: AtlasSpacing.xs),
      child: Row(
        children: [
          for (final c in wardrobeCategories)
            Padding(
              padding: const EdgeInsets.only(right: AtlasSpacing.xs),
              child: ChoiceChip(
                key: Key('wardrobe.category.$c'),
                label: Text(WardrobeLabels.category(c)),
                selected: selected == c,
                onSelected: (_) => onSelected(c),
              ),
            ),
        ],
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.onExpired});
  final WardrobeItem item;
  final VoidCallback onExpired;

  @override
  Widget build(BuildContext context) {
    final thumb = thumbnailOf(item);
    final label = item.subcategory != null
        ? WardrobeLabels.subcategory(item.subcategory!)
        : WardrobeLabels.category(item.category);
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        key: Key('wardrobe.item.${item.id}'),
        borderRadius: AtlasRadii.card,
        onTap: () => context.push(AtlasRoutes.wardrobeItem(item.id)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: AtlasRadii.card,
                child: SizedBox.expand(
                  child: thumb == null
                      ? const ColoredBox(color: AtlasColors.skeleton, child: Icon(Icons.checkroom_outlined))
                      : SignedImage(image: thumb, onExpired: onExpired),
                ),
              ),
            ),
            const SizedBox(height: AtlasSpacing.xxs),
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.labelLarge),
          ],
        ),
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.state, required this.onRetry});
  final WardrobeListState state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final failure = state.loadMoreFailure;
    return Padding(
      padding: const EdgeInsets.fromLTRB(AtlasSpacing.screen, AtlasSpacing.md, AtlasSpacing.screen, 96),
      child: switch (state) {
        _ when failure != null => Row(
          children: [
            Expanded(child: Text(failure.userMessage)),
            TextButton(
              key: const Key('wardrobe.loadMoreRetry'),
              onPressed: onRetry,
              child: const Text('Qayta urinish'),
            ),
          ],
        ),
        WardrobeListState(status: ListStatus.loadingMore || ListStatus.refreshing) => const Skeleton(height: 120),
        _ => const SizedBox.shrink(),
      },
    );
  }
}
