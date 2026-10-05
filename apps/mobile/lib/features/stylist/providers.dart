import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import 'data/stylist_repository.dart';
import 'presentation/chat_controller.dart';
import 'presentation/conversation_list_controller.dart';

final stylistRepositoryProvider = Provider<StylistRepository>(
  (ref) => StylistRepository(ref.watch(atlasApiClientProvider)),
);

/// The 50 most recent conversations.
final conversationListProvider = NotifierProvider.autoDispose<ConversationListController, ConversationListState>(
  ConversationListController.new,
);

/// Key of a chat that has no conversation yet.
const newChatKey = 'new';

/// One chat screen: a conversation id, or [newChatKey]. Disposed with its
/// screen — messages are never kept on the device.
final chatControllerProvider = NotifierProvider.autoDispose.family<ChatController, ChatState, String>(
  ChatController.new,
);
