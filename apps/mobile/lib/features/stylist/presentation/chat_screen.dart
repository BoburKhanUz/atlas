import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../outfits/data/outfits_repository.dart' show outfitOccasions;
import '../../outfits/presentation/outfit_labels.dart';
import '../../weather/providers.dart';
import '../data/stylist_repository.dart';
import '../providers.dart';
import 'chat_controller.dart';

/// One conversation with the AI stylist.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.chatKey});

  /// A conversation id or [newChatKey].
  final String chatKey;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _draft = TextEditingController();
  String? _event;

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final c = ref.read(chatControllerProvider(widget.chatKey).notifier);
    var result = await c.send(_draft.text, event: _event);
    if (result == SendResult.needsConfirmation && mounted) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Yana yuborasizmi?'),
          content: const Text(
            'Oldingi xabar serverga yetib borgan bo‘lishi mumkin. Yana yuborsangiz, u ikki marta saqlanishi mumkin. '
            'Avval suhbatni yangilab tekshirishingiz mumkin.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Bekor qilish')),
            TextButton(
              key: const Key('chat.confirmResend'),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Yana yuborish'),
            ),
          ],
        ),
      );
      if (ok == true) result = await c.send(_draft.text, event: _event, confirmResend: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = chatControllerProvider(widget.chatKey);
    final s = ref.watch(provider);
    final c = ref.read(provider.notifier);
    // The draft is cleared only once the server confirmed the message.
    ref.listen(provider.select((x) => x.sent), (prev, next) {
      if (next > (prev ?? 0)) _draft.clear();
    });
    final text = Theme.of(context).textTheme;

    final Widget body = switch (s.status) {
      ChatStatus.loading => const LoadingView(items: 2, semanticLabel: 'Suhbat yuklanmoqda'),
      ChatStatus.notFound => const EmptyStateView(
        icon: Icons.search_off_rounded,
        title: 'Suhbat topilmadi',
        message: 'U mavjud emas yoki sizga tegishli emas.',
      ),
      ChatStatus.loadFailed =>
        s.failure is NoNetworkFailure
            ? OfflineStateView(onRetry: c.retryLoad)
            : ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.retryLoad),
      ChatStatus.ready => _Messages(state: s),
    };

    return Scaffold(
      appBar: AppBar(
        title: Text(s.title ?? (s.conversationId == null ? 'Yangi suhbat' : 'Suhbat'), maxLines: 1),
        actions: [
          if (s.conversationId != null)
            IconButton(
              key: const Key('chat.refresh'),
              tooltip: 'Yangilash',
              onPressed: s.busy ? null : c.refresh,
              icon: const Icon(Icons.refresh_rounded),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: body),
            if (s.status == ChatStatus.ready)
              // Notices + composer never take more than about half the screen
              // (large text, a long draft): they scroll instead of overflowing.
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.55),
                child: SingleChildScrollView(
                  reverse: true,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (s.startedNewConversation)
                        const _Notice(
                          key: Key('chat.newConversation'),
                          text: 'Oldingi suhbat topilmadi — server yangi suhbat boshladi.',
                          color: AtlasColors.textSecondary,
                        ),
                      if (s.send == SendStatus.unknown) _UnknownBanner(chatKey: widget.chatKey, state: s),
                      if (s.send == SendStatus.failed)
                        _Notice(
                          key: const Key('chat.failed'),
                          text: '${s.failure?.userMessage ?? 'Xabar yuborilmadi.'} Matningiz saqlanib qoldi.',
                          color: AtlasColors.error,
                        ),
                      if (s.summary case final sum?)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
                          child: Text(
                            [
                              '${sum.wardrobeItemCount} ta kiyim hisobga olindi',
                              if (sum.weatherProvided) 'ob-havo',
                              if (sum.eventProvided) 'tadbir',
                            ].join(' · '),
                            key: const Key('chat.summary'),
                            style: text.labelSmall,
                          ),
                        ),
                      _Composer(
                        draft: _draft,
                        state: s,
                        event: _event,
                        onEvent: (e) => setState(() => _event = e),
                        onSend: _send,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Messages extends StatelessWidget {
  const _Messages({required this.state});
  final ChatState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final items = <Widget>[
      for (final m in s.messages) _Bubble(message: m),
      if (s.pending != null)
        _Bubble(
          message: ChatMessage(role: 'user', content: s.pending!),
          pending: true,
        ),
      if (s.send == SendStatus.sending) const _Typing(),
    ];
    if (items.isEmpty) {
      return const EmptyStateView(
        icon: Icons.auto_awesome_outlined,
        title: 'Nima haqida gaplashamiz?',
        message: 'Garderobingiz, ob-havo yoki tadbir haqida so‘rang. Stilist javobni kiyimlaringizga qarab beradi.',
      );
    }
    // Reversed: the newest message sits at the bottom and new ones scroll
    // into view on their own.
    return ListView(
      key: const Key('chat.messages'),
      reverse: true,
      padding: const EdgeInsets.all(AtlasSpacing.md),
      children: items.reversed.toList(),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, this.pending = false});
  final ChatMessage message;
  final bool pending;

  @override
  Widget build(BuildContext context) {
    final mine = message.fromUser;
    final text = Theme.of(context).textTheme;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        // One semantics node per bubble, at least 48 px high: the text is
        // selectable (long press), so the bubble is a touch target.
        child: MergeSemantics(
          child: Container(
            margin: const EdgeInsets.only(bottom: AtlasSpacing.xs),
            padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.sm, vertical: AtlasSpacing.xs),
            constraints: const BoxConstraints(minHeight: 48),
            decoration: BoxDecoration(
              color: mine ? AtlasColors.accent.withValues(alpha: pending ? 0.55 : 1) : AtlasColors.surface,
              borderRadius: AtlasRadii.field,
              border: mine ? null : Border.all(color: AtlasColors.hairline),
            ),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              widthFactor: 1,
              child: SelectableText(
                message.content,
                key: pending ? const Key('chat.pending') : null,
                style: text.bodyMedium?.copyWith(color: mine ? AtlasColors.onAccent : AtlasColors.textPrimary),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Typing extends StatelessWidget {
  const _Typing();

  @override
  Widget build(BuildContext context) => const Align(
    alignment: Alignment.centerLeft,
    child: Padding(
      padding: EdgeInsets.symmetric(vertical: AtlasSpacing.xs),
      child: Row(
        key: Key('chat.typing'),
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: AtlasSpacing.xs),
          Text('Stilist yozmoqda…'),
        ],
      ),
    ),
  );
}

class _Notice extends StatelessWidget {
  const _Notice({super.key, required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(AtlasSpacing.screen, AtlasSpacing.xs, AtlasSpacing.screen, 0),
    child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color)),
  );
}

class _UnknownBanner extends ConsumerWidget {
  const _UnknownBanner({required this.chatKey, required this.state});
  final String chatKey;
  final ChatState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.read(chatControllerProvider(chatKey).notifier);
    return Container(
      key: const Key('chat.unknown'),
      margin: const EdgeInsets.fromLTRB(AtlasSpacing.screen, AtlasSpacing.xs, AtlasSpacing.screen, 0),
      padding: const EdgeInsets.all(AtlasSpacing.sm),
      decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Javob kelmadi. Xabar serverga yetib bordimi — noma’lum. Matningiz saqlanib qoldi.',
            style: TextStyle(color: AtlasColors.warning),
          ),
          Wrap(
            spacing: AtlasSpacing.xs,
            children: [
              if (state.conversationId != null)
                TextButton(
                  key: const Key('chat.refreshFromServer'),
                  onPressed: state.busy ? null : c.refresh,
                  child: const Text('Suhbatni yangilash'),
                )
              else
                TextButton(
                  key: const Key('chat.openList'),
                  onPressed: () {
                    ref.invalidate(conversationListProvider);
                    context.pop();
                  },
                  child: const Text('Suhbatlar ro‘yxati'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Composer extends ConsumerWidget {
  const _Composer({
    required this.draft,
    required this.state,
    required this.event,
    required this.onEvent,
    required this.onSend,
  });
  final TextEditingController draft;
  final ChatState state;
  final String? event;
  final void Function(String?) onEvent;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final sending = state.send == SendStatus.sending;
    final weather = ref.watch(weatherControllerProvider.notifier).freshWeather;
    ref.watch(weatherControllerProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(AtlasSpacing.md, AtlasSpacing.xs, AtlasSpacing.md, AtlasSpacing.sm),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final o in [null, ...outfitOccasions])
                  Padding(
                    padding: const EdgeInsets.only(right: AtlasSpacing.xs),
                    child: ChoiceChip(
                      key: Key('chat.event.${o ?? 'none'}'),
                      label: Text(o == null ? 'Tadbirsiz' : OutfitLabels.occasion(o)),
                      selected: event == o,
                      onSelected: sending ? null : (_) => onEvent(o),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AtlasSpacing.xs),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: draft,
            builder: (context, value, _) {
              final length = value.text.trim().length;
              final valid = StylistLimits.validMessage(value.text) != null;
              return Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('chat.input'),
                      controller: draft,
                      enabled: !sending,
                      minLines: 1,
                      maxLines: 5,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(
                        hintText: 'Stilistga yozing…',
                        counterText: '$length / ${StylistLimits.maxMessage}',
                        counterStyle: length > StylistLimits.maxMessage
                            ? text.labelSmall?.copyWith(color: AtlasColors.error)
                            : text.labelSmall,
                      ),
                    ),
                  ),
                  const SizedBox(width: AtlasSpacing.xs),
                  IconButton.filled(
                    key: const Key('chat.send'),
                    tooltip: 'Yuborish',
                    onPressed: valid && !state.busy ? onSend : null,
                    icon: sending
                        ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              );
            },
          ),
          Text(
            [
              if (weather != null) 'Hozirgi ob-havo hisobga olinadi.',
              'Stilist suhbatda aytgan afzalliklaringizni eslab qolishi mumkin.',
            ].join(' '),
            key: const Key('chat.disclosure'),
            style: text.labelSmall,
          ),
        ],
      ),
    );
  }
}
