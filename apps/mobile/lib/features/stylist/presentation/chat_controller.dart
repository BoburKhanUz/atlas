import 'package:atlas_api/atlas_api.dart' show StylistChatResponseContextSummary;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../../weather/providers.dart';
import '../data/stylist_repository.dart';
import '../providers.dart';

enum ChatStatus { loading, ready, loadFailed, notFound }

enum SendStatus {
  idle,
  sending,

  /// The server answered with an error: the message was not stored. The
  /// draft stays.
  failed,

  /// The answer was lost (timeout, connection, 5xx): the server may have
  /// stored the message (and answered). Never re-sent automatically; the
  /// user refreshes from the server and may explicitly send again.
  unknown,
}

@immutable
class ChatState {
  const ChatState({
    this.status = ChatStatus.loading,
    this.conversationId,
    this.title,
    this.messages = const [],
    this.send = SendStatus.idle,
    this.pending,
    this.failure,
    this.summary,
    this.refreshing = false,
    this.resendNeedsConfirmation = false,
    this.startedNewConversation = false,
    this.sent = 0,
  });

  final ChatStatus status;
  final String? conversationId;
  final String? title;

  /// As the server returned them (plus the confirmed turn after a send).
  final List<ChatMessage> messages;
  final SendStatus send;

  /// The text being sent / whose outcome is unknown (shown, not stored).
  final String? pending;
  final ApiFailure? failure;

  /// What the server used as context for its last answer.
  final StylistChatResponseContextSummary? summary;
  final bool refreshing;

  /// After an unknown outcome, sending again needs the user's confirmation
  /// (it may duplicate the message).
  final bool resendNeedsConfirmation;

  /// The server answered with a different conversation id than the one sent
  /// (an unknown or foreign id makes it start a new conversation).
  final bool startedNewConversation;

  /// Confirmed sends (the composer clears its draft when this grows).
  final int sent;

  bool get busy => send == SendStatus.sending || refreshing;

  ChatState copyWith({
    ChatStatus? status,
    String? conversationId,
    String? Function()? title,
    List<ChatMessage>? messages,
    SendStatus? send,
    String? Function()? pending,
    ApiFailure? Function()? failure,
    StylistChatResponseContextSummary? Function()? summary,
    bool? refreshing,
    bool? resendNeedsConfirmation,
    bool? startedNewConversation,
    int? sent,
  }) => ChatState(
    status: status ?? this.status,
    conversationId: conversationId ?? this.conversationId,
    title: title == null ? this.title : title(),
    messages: messages ?? this.messages,
    send: send ?? this.send,
    pending: pending == null ? this.pending : pending(),
    failure: failure == null ? this.failure : failure(),
    summary: summary == null ? this.summary : summary(),
    refreshing: refreshing ?? this.refreshing,
    resendNeedsConfirmation: resendNeedsConfirmation ?? this.resendNeedsConfirmation,
    startedNewConversation: startedNewConversation ?? this.startedNewConversation,
    sent: sent ?? this.sent,
  );
}

/// Outcome of [ChatController.send].
enum SendResult { sent, invalid, blocked, needsConfirmation, failed, unknown }

/// One conversation. Sending is ONE POST per explicit action, never retried
/// automatically; the draft stays in the composer until the server
/// confirms. After a lost answer the app does not guess: it shows the
/// server's transcript on request ("refresh") and re-sending is an explicit,
/// confirmed action.
class ChatController extends Notifier<ChatState> {
  ChatController(this.key);

  /// A conversation id, or [newChatKey].
  final String key;

  StylistRepository get _repo => ref.read(stylistRepositoryProvider);

  @override
  ChatState build() {
    if (key == newChatKey) return const ChatState(status: ChatStatus.ready);
    Future.microtask(() => _load(key));
    return ChatState(conversationId: key);
  }

  Future<void> _load(String id) async {
    try {
      final c = await _repo.conversation(id);
      if (!ref.mounted) return;
      state = state.copyWith(status: ChatStatus.ready, title: () => c.title, messages: c.messages);
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      final missing = f is ApiHttpFailure && f.code == ApiErrorCode.notFound;
      state = state.copyWith(status: missing ? ChatStatus.notFound : ChatStatus.loadFailed, failure: () => f);
    }
  }

  Future<void> retryLoad() async {
    final id = state.conversationId;
    if (id == null || state.status != ChatStatus.loadFailed) return;
    state = state.copyWith(status: ChatStatus.loading, failure: () => null);
    await _load(id);
  }

  /// Sends [draft] (trimmed, 1–2000 characters) with an optional occasion
  /// and the weather when it is fresh. After an unknown outcome the user
  /// must confirm ([confirmResend]) that sending again may duplicate.
  Future<SendResult> send(String draft, {String? event, bool confirmResend = false}) async {
    final message = StylistLimits.validMessage(draft);
    if (message == null) return SendResult.invalid;
    if (state.busy || state.status != ChatStatus.ready) return SendResult.blocked;
    if (state.resendNeedsConfirmation && !confirmResend) return SendResult.needsConfirmation;
    final weather = ref.read(weatherControllerProvider.notifier).freshWeather;
    final sentId = state.conversationId;
    state = state.copyWith(send: SendStatus.sending, pending: () => message, failure: () => null);
    try {
      final r = await _repo.send(
        message: message,
        conversationId: sentId,
        event: event != null && event.length <= StylistLimits.maxEvent ? event : null,
        weather: weather == null ? null : stylistWeatherOf(weather),
      );
      if (!ref.mounted) return SendResult.sent;
      final switched = sentId != null && r.conversationId != sentId;
      if (switched) AppLog.info('stylist: the server started a new conversation');
      state = state.copyWith(
        conversationId: r.conversationId,
        // A different conversation: the earlier messages are not part of it.
        messages: [
          if (!switched) ...state.messages,
          ChatMessage(role: 'user', content: message),
          ChatMessage(role: 'assistant', content: r.assistantMessage),
        ],
        title: switched || sentId == null ? () => null : null,
        send: SendStatus.idle,
        pending: () => null,
        summary: () => r.contextSummary,
        resendNeedsConfirmation: false,
        startedNewConversation: switched || state.startedNewConversation,
        sent: state.sent + 1,
      );
      ref.invalidate(conversationListProvider);
      return SendResult.sent;
    } on ApiFailure catch (f) {
      AppLog.info('stylist message: ${f.describe()}');
      if (!ref.mounted) return SendResult.failed;
      if (_definitelyNotStored(f)) {
        state = state.copyWith(send: SendStatus.failed, pending: () => null, failure: () => f);
        return SendResult.failed;
      }
      state = state.copyWith(send: SendStatus.unknown, failure: () => f, resendNeedsConfirmation: true);
      return SendResult.unknown;
    }
  }

  /// Shows what the server has (after an unknown outcome or any time). No
  /// matching is attempted: the transcript replaces the local one, the draft
  /// stays in the composer, and re-sending still needs confirmation.
  Future<void> refresh() async {
    final id = state.conversationId;
    if (id == null || state.busy) return;
    state = state.copyWith(refreshing: true);
    try {
      final c = await _repo.conversation(id);
      if (!ref.mounted) return;
      state = state.copyWith(
        refreshing: false,
        status: ChatStatus.ready,
        title: () => c.title,
        messages: c.messages,
        send: state.send == SendStatus.unknown ? SendStatus.idle : state.send,
        pending: () => null,
        failure: () => null,
      );
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('conversation not refreshed: ${f.describe()}');
      state = state.copyWith(refreshing: false, failure: () => f);
    }
  }

  /// The server answered and stored nothing (or the request never left).
  static bool _definitelyNotStored(ApiFailure f) => switch (f) {
    ApiHttpFailure(:final statusCode) => statusCode < 500,
    SessionEndedFailure() || InsecureConnectionFailure() || SecureStorageFailure() => true,
    _ => false,
  };
}
