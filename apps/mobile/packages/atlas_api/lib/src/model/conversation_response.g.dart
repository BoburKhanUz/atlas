// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ConversationResponse extends ConversationResponse {
  @override
  final ConversationResponseConversation conversation;

  factory _$ConversationResponse([void Function(ConversationResponseBuilder)? updates]) =>
      (ConversationResponseBuilder()..update(updates))._build();

  _$ConversationResponse._({required this.conversation}) : super._();
  @override
  ConversationResponse rebuild(void Function(ConversationResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ConversationResponseBuilder toBuilder() => ConversationResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ConversationResponse && conversation == other.conversation;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, conversation.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ConversationResponse')..add('conversation', conversation)).toString();
  }
}

class ConversationResponseBuilder implements Builder<ConversationResponse, ConversationResponseBuilder> {
  _$ConversationResponse? _$v;

  ConversationResponseConversationBuilder? _conversation;
  ConversationResponseConversationBuilder get conversation =>
      _$this._conversation ??= ConversationResponseConversationBuilder();
  set conversation(ConversationResponseConversationBuilder? conversation) => _$this._conversation = conversation;

  ConversationResponseBuilder() {
    ConversationResponse._defaults(this);
  }

  ConversationResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _conversation = $v.conversation.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ConversationResponse other) {
    _$v = other as _$ConversationResponse;
  }

  @override
  void update(void Function(ConversationResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ConversationResponse build() => _build();

  _$ConversationResponse _build() {
    _$ConversationResponse _$result;
    try {
      _$result = _$v ?? _$ConversationResponse._(conversation: conversation.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'conversation';
        conversation.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ConversationResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
