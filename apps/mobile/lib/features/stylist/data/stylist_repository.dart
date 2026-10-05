import 'package:atlas_api/atlas_api.dart';
import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../outfits/data/generated_outfits.dart' show NullableText;

/// Limits of `StylistChatRequest`.
abstract final class StylistLimits {
  static const maxMessage = 2000;
  static const maxEvent = 60;

  /// The text to send (trimmed), or null when it is empty or too long. The
  /// length is counted like the server (UTF-16 code units).
  static String? validMessage(String input) {
    final text = input.trim();
    return text.isEmpty || text.length > maxMessage ? null : text;
  }
}

/// The weather fields the stylist accepts (only FRESH weather is ever sent).
typedef StylistWeather = ({
  num temperature,
  num feelsLike,
  String condition,
  num precipitationProbability,
  num humidity,
  num windSpeed,
  num uvIndex,
});

StylistWeather stylistWeatherOf(WeatherResponseWeather w) => (
  temperature: w.temperature,
  feelsLike: w.feelsLike,
  condition: w.condition,
  precipitationProbability: w.precipitationProbability,
  humidity: w.humidity,
  windSpeed: w.windSpeed,
  uvIndex: w.uvIndex,
);

/// One message of a conversation.
@immutable
class ChatMessage {
  const ChatMessage({required this.role, required this.content, this.id, this.createdAt});

  factory ChatMessage.of(ConversationResponseConversationMessagesInner m) =>
      ChatMessage(id: m.id, role: m.role, content: m.content, createdAt: m.createdAt);

  final String? id;

  /// `user` or `assistant`.
  final String role;
  final String content;
  final DateTime? createdAt;

  bool get fromUser => role == 'user';

  /// Never prints the content.
  @override
  String toString() => 'ChatMessage($role)';
}

@immutable
class ConversationSummary {
  const ConversationSummary({
    required this.id,
    required this.title,
    required this.lastMessage,
    required this.updatedAt,
  });
  final String id;
  final String? title;
  final String? lastMessage;
  final DateTime updatedAt;

  @override
  String toString() => 'ConversationSummary';
}

@immutable
class Conversation {
  const Conversation({required this.id, required this.title, required this.messages});
  final String id;
  final String? title;
  final List<ChatMessage> messages;
}

/// Stylist operations of docs/api/openapi.json. Every method throws
/// `ApiFailure`. [send] is ONE request and is never retried automatically
/// (the endpoint has no Idempotency-Key).
class StylistRepository {
  StylistRepository(this._client);
  final AtlasApiClient _client;

  Future<StylistChatResponse> send({
    required String message,
    String? conversationId,
    String? event,
    StylistWeather? weather,
  }) {
    final request = StylistChatRequest(
      (b) => b
        ..message = message
        ..conversationId = conversationId
        ..event = event
        ..weather = weather == null
            ? null
            : (StylistChatRequestWeatherBuilder()
                ..temperature = weather.temperature
                ..feelsLike = weather.feelsLike
                ..condition = weather.condition
                ..precipitationProbability = weather.precipitationProbability
                ..humidity = weather.humidity
                ..windSpeed = weather.windSpeed
                ..uvIndex = weather.uvIndex),
    );
    return _client.call((api) => api.getStylistApi().stylistChat(stylistChatRequest: request));
  }

  Future<List<ConversationSummary>> conversations() async {
    final r = await _client.call((api) => api.getStylistApi().listConversations());
    return [
      for (final c in r.conversations)
        ConversationSummary(id: c.id, title: c.title.text, lastMessage: c.lastMessage.text, updatedAt: c.updatedAt),
    ];
  }

  Future<Conversation> conversation(String id) async {
    final c = (await _client.call((api) => api.getStylistApi().getConversation(id: id))).conversation;
    return Conversation(id: c.id, title: c.title.text, messages: c.messages.map(ChatMessage.of).toList());
  }
}
