import 'package:atlas_api/atlas_api.dart' show OutfitGenerateResponseOutfitsInner;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
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
  const CandidateCard({super.key, required this.candidate, this.index});
  final OutfitGenerateResponseOutfitsInner candidate;

  /// Position in the suggestions (1-based), for the title.
  final int? index;

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
    final reasons = readableReasons(o);

    final canFeedback = !(c.busy || c.save == SaveStatus.unknown);
    return AtlasCard(
      key: Key('candidate.$id'),
      padding: const EdgeInsets.all(AtlasSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(widget.index == null ? 'Obraz' : '${widget.index}-variant', style: text.titleLarge)),
              if (c.isSaved) ...[
                const Icon(Icons.bookmark_rounded, color: AtlasColors.accent, semanticLabel: 'Saqlangan'),
                const SizedBox(width: AtlasSpacing.xs),
              ],
              _ScoreBadge(score: o.score.round()),
            ],
          ),
          const SizedBox(height: AtlasSpacing.md),
          LayoutBuilder(
            builder: (context, box) {
              // Up to three tiles across; more scroll sideways.
              const gap = AtlasSpacing.xs;
              final across = o.items.length.clamp(1, 3);
              final tile = (box.maxWidth - gap * (across - 1)) / across;
              return SizedBox(
                // Image + two label lines, which grow with the text size.
                height: tile + AtlasSpacing.xs + MediaQuery.textScalerOf(context).scale(17) * 2 + 4,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: o.items.length,
                  separatorBuilder: (_, _) => const SizedBox(width: gap),
                  itemBuilder: (context, i) {
                    final item = o.items[i];
                    final name = WardrobeLabels.subcategory(item.subcategory.text ?? item.category);
                    return SizedBox(
                      width: tile,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ClipRRect(
                            borderRadius: AtlasRadii.field,
                            child: ColoredBox(
                              color: AtlasColors.sand,
                              child: SizedBox.square(
                                dimension: tile,
                                // Decorative: the name is the text just below.
                                child: GeneratedItemImage(itemId: item.id, imageUrl: item.imageUrl.text),
                              ),
                            ),
                          ),
                          const SizedBox(height: AtlasSpacing.xs),
                          Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.labelLarge),
                          Text(
                            OutfitLabels.role(item.layeringRole.name),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall,
                          ),
                        ],
                      ),
                    );
                  },
                ),
              );
            },
          ),
          const SizedBox(height: AtlasSpacing.md),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AtlasSpacing.sm),
            decoration: const BoxDecoration(color: AtlasColors.background, borderRadius: AtlasRadii.field),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.auto_awesome_rounded, size: 18, color: AtlasColors.accent),
                const SizedBox(width: AtlasSpacing.xs),
                Expanded(
                  child: Text(
                    explanation ?? 'Bu obraz ob-havo, tadbir va uslubingizga qarab tanlandi.',
                    key: Key('candidate.$id.explanation'),
                    maxLines: _why ? null : 3,
                    overflow: _why ? null : TextOverflow.ellipsis,
                    style: text.bodyMedium?.copyWith(color: AtlasColors.textPrimary),
                  ),
                ),
              ],
            ),
          ),
          if (reasons.isNotEmpty) ...[
            const SizedBox(height: AtlasSpacing.sm),
            Wrap(
              spacing: AtlasSpacing.xs,
              runSpacing: AtlasSpacing.xs,
              children: [for (final r in reasons.take(_why ? reasons.length : 3)) _Reason(label: r)],
            ),
          ],
          TextButton.icon(
            key: Key('candidate.$id.why'),
            onPressed: () => setState(() => _why = !_why),
            icon: Icon(_why ? Icons.expand_less_rounded : Icons.expand_more_rounded),
            label: Text(_why ? 'Qisqaroq' : 'Nega aynan shu?'),
          ),
          _Status(tempId: id, state: c),
          Row(
            children: [
              Expanded(
                child: _FeedbackButton(
                  key: Key('candidate.$id.like'),
                  label: 'Yoqdi',
                  icon: Icons.thumb_up_outlined,
                  selectedIcon: Icons.thumb_up_rounded,
                  selected: c.feedback == OutfitFeedback.liked,
                  onPressed: canFeedback ? () => ctl.feedback(id, OutfitFeedback.liked) : null,
                ),
              ),
              const SizedBox(width: AtlasSpacing.xs),
              Expanded(
                child: _FeedbackButton(
                  key: Key('candidate.$id.dislike'),
                  label: 'Yoqmadi',
                  icon: Icons.thumb_down_outlined,
                  selectedIcon: Icons.thumb_down_rounded,
                  selected: c.feedback == OutfitFeedback.disliked,
                  onPressed: canFeedback ? () => ctl.feedback(id, OutfitFeedback.disliked) : null,
                ),
              ),
            ],
          ),
          if (c.isSaved && c.outfitId != null) ...[
            const SizedBox(height: AtlasSpacing.xs),
            AtlasButton(
              key: Key('candidate.$id.open'),
              label: 'Saqlangan obrazni ochish',
              icon: Icons.open_in_new_rounded,
              variant: AtlasButtonVariant.secondary,
              onPressed: () => context.push(AtlasRoutes.outfitDetail(c.outfitId!)),
            ),
          ] else if (c.save != SaveStatus.unknown) ...[
            const SizedBox(height: AtlasSpacing.xs),
            AtlasButton(
              key: Key('candidate.$id.save'),
              label: c.save == SaveStatus.failed ? 'Qayta saqlash' : 'Saqlash',
              icon: Icons.bookmark_add_outlined,
              loading: c.save == SaveStatus.saving || c.save == SaveStatus.checking,
              onPressed: c.busy ? null : () => ctl.save(id),
            ),
          ],
        ],
      ),
    );
  }
}

class _ScoreBadge extends StatelessWidget {
  const _ScoreBadge({required this.score});
  final int score;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Moslik $score foiz',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm, vertical: AtlasSpacing.xxs + 2),
        decoration: BoxDecoration(color: AtlasColors.accentSoft, borderRadius: BorderRadius.circular(AtlasRadii.pill)),
        child: Text(
          '$score% mos',
          style: Theme.of(context).textTheme.labelLarge?.copyWith(color: AtlasColors.accentStrong),
        ),
      ),
    );
  }
}

class _Reason extends StatelessWidget {
  const _Reason({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm, vertical: AtlasSpacing.xxs + 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AtlasRadii.pill),
        border: Border.all(color: AtlasColors.hairline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check_rounded, size: 16, color: AtlasColors.accent),
          const SizedBox(width: AtlasSpacing.xxs),
          Flexible(child: Text(label, style: Theme.of(context).textTheme.labelMedium)),
        ],
      ),
    );
  }
}

class _FeedbackButton extends StatelessWidget {
  const _FeedbackButton({
    super.key,
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.selected,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final bool selected;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm),
          backgroundColor: selected ? AtlasColors.accentSoft : null,
          foregroundColor: selected ? AtlasColors.accentStrong : AtlasColors.textPrimary,
          side: BorderSide(color: selected ? AtlasColors.accent : AtlasColors.hairline),
        ),
        icon: Icon(selected ? selectedIcon : icon, size: 18),
        label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
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
