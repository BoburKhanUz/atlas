import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../data/stylist_repository.dart';
import '../providers.dart';
import 'conversation_list_controller.dart';

/// The Stylist tab: recent conversations and "New chat".
class StylistScreen extends ConsumerWidget {
  const StylistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(conversationListProvider);
    final c = ref.read(conversationListProvider.notifier);
    return AtlasPage(
      title: 'Stilist',
      onRefresh: c.refresh,
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('stylist.new'),
        onPressed: () => context.push(AtlasRoutes.stylistNew),
        icon: const Icon(Icons.add_comment_outlined),
        label: const Text('Yangi suhbat'),
      ),
      slivers: [
        switch (s.status) {
          ConversationListStatus.loading => const SliverFillRemaining(child: LoadingView()),
          ConversationListStatus.failed => SliverFillRemaining(
            child: s.failure is NoNetworkFailure
                ? OfflineStateView(onRetry: c.refresh)
                : ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.refresh),
          ),
          _ when s.conversations.isEmpty => SliverFillRemaining(
            child: EmptyStateView(
              key: const Key('stylist.empty'),
              icon: Icons.auto_awesome_outlined,
              title: 'Stilistingiz bilan gaplashing',
              message: 'Masalan: “Bugun ishga nima kiyay?” yoki “Qora shimga qaysi rang mos?”',
              actionLabel: 'Suhbat boshlash',
              onAction: () => context.push(AtlasRoutes.stylistNew),
            ),
          ),
          _ => SliverPadding(
            padding: const EdgeInsets.fromLTRB(AtlasSpacing.screen, 0, AtlasSpacing.screen, 96),
            sliver: SliverList.separated(
              itemCount: s.conversations.length,
              separatorBuilder: (_, _) => const SizedBox(height: AtlasSpacing.sm),
              itemBuilder: (context, i) => _ConversationRow(conversation: s.conversations[i]),
            ),
          ),
        },
      ],
    );
  }
}

class _ConversationRow extends StatelessWidget {
  const _ConversationRow({required this.conversation});
  final ConversationSummary conversation;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AtlasCard(
      key: Key('stylist.conversation.${conversation.id}'),
      onTap: () => context.push(AtlasRoutes.stylistChat(conversation.id)),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: AtlasColors.accentSoft,
            child: Icon(Icons.auto_awesome_outlined, color: AtlasColors.accent),
          ),
          const SizedBox(width: AtlasSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  conversation.title ?? 'Suhbat',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
                if (conversation.lastMessage != null)
                  Text(conversation.lastMessage!, maxLines: 2, overflow: TextOverflow.ellipsis, style: text.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: AtlasSpacing.xs),
          Text(relativeTime(conversation.updatedAt, DateTime.now()), style: text.labelSmall),
        ],
      ),
    );
  }
}

/// "hozir", "5 daq", "3 soat", "kecha", "12.09".
String relativeTime(DateTime t, DateTime now) {
  final d = now.difference(t);
  if (d.inMinutes < 1) return 'hozir';
  if (d.inHours < 1) return '${d.inMinutes} daq';
  if (d.inDays < 1) return '${d.inHours} soat';
  if (d.inDays < 2) return 'kecha';
  final l = t.toLocal();
  return '${l.day.toString().padLeft(2, '0')}.${l.month.toString().padLeft(2, '0')}';
}

/// The Home entry point.
class AskStylistButton extends StatelessWidget {
  const AskStylistButton({super.key});

  @override
  Widget build(BuildContext context) => AtlasButton(
    key: const Key('home.stylist'),
    label: 'Stilistdan so‘rash',
    icon: Icons.chat_bubble_outline_rounded,
    variant: AtlasButtonVariant.secondary,
    onPressed: () => context.push(AtlasRoutes.stylistNew),
  );
}
