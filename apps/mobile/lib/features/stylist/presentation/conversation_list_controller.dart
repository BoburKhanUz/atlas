import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_failure.dart';
import '../data/stylist_repository.dart';
import '../providers.dart';

enum ConversationListStatus { loading, ready, refreshing, failed }

@immutable
class ConversationListState {
  const ConversationListState({
    this.status = ConversationListStatus.loading,
    this.conversations = const [],
    this.failure,
  });
  final ConversationListStatus status;

  /// Newest first (server order: `updatedAt` descending).
  final List<ConversationSummary> conversations;

  /// A failed refresh keeps the list on screen.
  final ApiFailure? failure;
}

class ConversationListController extends Notifier<ConversationListState> {
  @override
  ConversationListState build() {
    Future.microtask(_load);
    return const ConversationListState();
  }

  Future<void> refresh() async {
    if (state.status == ConversationListStatus.loading || state.status == ConversationListStatus.refreshing) return;
    state = ConversationListState(
      status: state.conversations.isEmpty ? ConversationListStatus.loading : ConversationListStatus.refreshing,
      conversations: state.conversations,
    );
    await _load();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(stylistRepositoryProvider).conversations();
      if (!ref.mounted) return;
      state = ConversationListState(status: ConversationListStatus.ready, conversations: list);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('conversations not loaded: ${f.describe()}');
      state = ConversationListState(
        status: state.conversations.isEmpty ? ConversationListStatus.failed : ConversationListStatus.ready,
        conversations: state.conversations,
        failure: f,
      );
    }
  }
}
