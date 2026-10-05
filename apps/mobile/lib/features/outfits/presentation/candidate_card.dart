import 'package:atlas_api/atlas_api.dart' show OutfitGenerateResponseOutfitsInner;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../wardrobe/presentation/wardrobe_labels.dart';
import '../data/generated_outfits.dart';
import '../data/outfits_repository.dart';
import '../providers.dart';
import 'generate_controller.dart';
import 'outfit_images.dart';
import 'outfit_labels.dart';

/// One generated suggestion: items, score, reasons, "Nega?", like/dislike
/// and save, with the honest save status (D4).
class CandidateCard extends ConsumerStatefulWidget {
  const CandidateCard({super.key, required this.candidate});
  final OutfitGenerateResponseOutfitsInner candidate;

  @override
  ConsumerState<CandidateCard> createState() => _CandidateCardState();
}

class _CandidateCardState extends ConsumerState<CandidateCard> {
  bool _why = false;

  @override
  Widget build(BuildContext context) {
    final o = widget.candidate;
    final id = o.tempId;
    final c = ref.watch(generateControllerProvider.select((s) => s.candidate(id)));
    final ctl = ref.read(generateControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final explanation = o.explanation.text;

    return AtlasCard(
      key: Key('candidate.$id'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Moslik: ${o.score.round()}%', style: text.titleMedium)),
              if (c.isSaved) const Icon(Icons.bookmark_rounded, color: AtlasColors.accent, semanticLabel: 'Saqlangan'),
            ],
          ),
          const SizedBox(height: AtlasSpacing.sm),
          SizedBox(
            // Image + two label lines, which grow with the text size.
            height: 96 + AtlasSpacing.xxs + MediaQuery.textScalerOf(context).scale(18) * 2 + 4,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: o.items.length,
              separatorBuilder: (_, _) => const SizedBox(width: AtlasSpacing.xs),
              itemBuilder: (context, i) {
                final item = o.items[i];
                final name = WardrobeLabels.subcategory(item.subcategory.text ?? item.category);
                return SizedBox(
                  width: 96,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ClipRRect(
                        borderRadius: AtlasRadii.field,
                        child: SizedBox.square(
                          dimension: 96,
                          child: GeneratedItemImage(itemId: item.id, imageUrl: item.imageUrl.text, semanticLabel: name),
                        ),
                      ),
                      const SizedBox(height: AtlasSpacing.xxs),
                      Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.labelMedium),
                      Text(
                        OutfitLabels.role(item.role),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.labelSmall,
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          if (o.reasons.isNotEmpty) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Wrap(
              spacing: AtlasSpacing.xs,
              runSpacing: AtlasSpacing.xs,
              children: [
                for (final r in o.reasons.take(_why ? o.reasons.length : 3))
                  Chip(label: Text(r), visualDensity: VisualDensity.compact),
              ],
            ),
          ],
          TextButton.icon(
            key: Key('candidate.$id.why'),
            onPressed: () => setState(() => _why = !_why),
            icon: Icon(_why ? Icons.expand_less_rounded : Icons.expand_more_rounded),
            label: const Text('Nega?'),
          ),
          if (_why)
            Text(
              explanation ?? 'Bu obraz ob-havo, tadbir va uslubingizga qarab tanlandi.',
              key: Key('candidate.$id.explanation'),
              style: text.bodyMedium,
            ),
          const SizedBox(height: AtlasSpacing.xs),
          _Status(tempId: id, state: c),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              IconButton(
                key: Key('candidate.$id.like'),
                tooltip: 'Yoqdi',
                isSelected: c.feedback == OutfitFeedback.liked,
                onPressed: c.busy || c.save == SaveStatus.unknown ? null : () => ctl.feedback(id, OutfitFeedback.liked),
                icon: const Icon(Icons.thumb_up_outlined),
                selectedIcon: const Icon(Icons.thumb_up_rounded, color: AtlasColors.accent),
              ),
              IconButton(
                key: Key('candidate.$id.dislike'),
                tooltip: 'Yoqmadi',
                isSelected: c.feedback == OutfitFeedback.disliked,
                onPressed: c.busy || c.save == SaveStatus.unknown
                    ? null
                    : () => ctl.feedback(id, OutfitFeedback.disliked),
                icon: const Icon(Icons.thumb_down_outlined),
                selectedIcon: const Icon(Icons.thumb_down_rounded, color: AtlasColors.accent),
              ),
              if (c.isSaved && c.outfitId != null)
                TextButton(
                  key: Key('candidate.$id.open'),
                  onPressed: () => context.push(AtlasRoutes.outfitDetail(c.outfitId!)),
                  child: const Text('Ochish'),
                )
              else if (c.save != SaveStatus.unknown)
                FilledButton.tonalIcon(
                  key: Key('candidate.$id.save'),
                  onPressed: c.busy ? null : () => ctl.save(id),
                  icon: c.save == SaveStatus.saving || c.save == SaveStatus.checking
                      ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.bookmark_add_outlined),
                  label: Text(c.save == SaveStatus.failed ? 'Qayta saqlash' : 'Saqlash'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Status extends ConsumerWidget {
  const _Status({required this.tempId, required this.state});
  final String tempId;
  final CandidateState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final ctl = ref.read(generateControllerProvider.notifier);
    final c = state;
    if (c.save == SaveStatus.checking) {
      return Text('Saqlanganligi tekshirilmoqda…', key: Key('candidate.$tempId.status'), style: text.bodySmall);
    }
    if (c.save == SaveStatus.unknown) {
      return Container(
        key: Key('candidate.$tempId.unknown'),
        padding: const EdgeInsets.all(AtlasSpacing.sm),
        margin: const EdgeInsets.only(bottom: AtlasSpacing.xs),
        decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Saqlash holati noma’lum: javob kelmadi, server uni saqlagan bo‘lishi mumkin. '
              '“Saqlanganlar”ni tekshiring.',
              style: TextStyle(color: AtlasColors.warning),
            ),
            Wrap(
              spacing: AtlasSpacing.xs,
              children: [
                TextButton(
                  key: Key('candidate.$tempId.recheck'),
                  onPressed: () => ctl.recheck(tempId),
                  child: const Text('Qayta tekshirish'),
                ),
                TextButton(
                  key: Key('candidate.$tempId.openSaved'),
                  onPressed: () => ref.read(outfitsTabProvider.notifier).show(OutfitsTab.saved),
                  child: const Text('Saqlanganlar'),
                ),
                TextButton(
                  key: Key('candidate.$tempId.saveAgain'),
                  onPressed: () => _confirmSaveAgain(context, ctl),
                  child: const Text('Yana saqlash'),
                ),
              ],
            ),
          ],
        ),
      );
    }
    final message = switch (c) {
      CandidateState(save: SaveStatus.failed) => c.failure?.userMessage ?? 'Saqlab bo‘lmadi.',
      CandidateState(feedbackFailed: true) => 'Fikr yuborilmadi. Qayta bosib ko‘ring.',
      CandidateState(feedback: OutfitFeedback.liked) =>
        'Fikringiz saqlandi — shunga o‘xshashlarni ko‘proq tavsiya qilamiz.',
      CandidateState(feedback: OutfitFeedback.disliked) =>
        'Fikringiz saqlandi — bunday kombinatsiyani kamroq tavsiya qilamiz.',
      CandidateState(isSaved: true) => 'Saqlandi.',
      _ => null,
    };
    if (message == null) return const SizedBox.shrink();
    final error = c.save == SaveStatus.failed || c.feedbackFailed;
    return Padding(
      padding: const EdgeInsets.only(bottom: AtlasSpacing.xs),
      child: Text(
        message,
        key: Key('candidate.$tempId.status'),
        style: text.bodySmall?.copyWith(color: error ? AtlasColors.error : AtlasColors.textSecondary),
      ),
    );
  }

  Future<void> _confirmSaveAgain(BuildContext context, GenerateController ctl) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Yana saqlaysizmi?'),
        content: const Text(
          'Oldingi saqlash serverda bajarilgan bo‘lishi mumkin. Yana saqlash ikkinchi nusxani yaratishi mumkin.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Bekor qilish')),
          TextButton(
            key: const Key('candidate.confirmSaveAgain'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Yana saqlash'),
          ),
        ],
      ),
    );
    if (ok == true) await ctl.saveAgain(tempId);
  }
}
