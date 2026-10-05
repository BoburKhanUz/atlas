// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation_list_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ConversationListResponse extends ConversationListResponse {
  @override
  final BuiltList<ConversationListResponseConversationsInner> conversations;

  factory _$ConversationListResponse([void Function(ConversationListResponseBuilder)? updates]) =>
      (ConversationListResponseBuilder()..update(updates))._build();

  _$ConversationListResponse._({required this.conversations}) : super._();
  @override
  ConversationListResponse rebuild(void Function(ConversationListResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ConversationListResponseBuilder toBuilder() => ConversationListResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ConversationListResponse && conversations == other.conversations;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, conversations.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ConversationListResponse')..add('conversations', conversations)).toString();
  }
}

class ConversationListResponseBuilder implements Builder<ConversationListResponse, ConversationListResponseBuilder> {
  _$ConversationListResponse? _$v;

  ListBuilder<ConversationListResponseConversationsInner>? _conversations;
  ListBuilder<ConversationListResponseConversationsInner> get conversations =>
      _$this._conversations ??= ListBuilder<ConversationListResponseConversationsInner>();
  set conversations(ListBuilder<ConversationListResponseConversationsInner>? conversations) =>
      _$this._conversations = conversations;

  ConversationListResponseBuilder() {
    ConversationListResponse._defaults(this);
  }

  ConversationListResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _conversations = $v.conversations.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ConversationListResponse other) {
    _$v = other as _$ConversationListResponse;
  }

  @override
  void update(void Function(ConversationListResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ConversationListResponse build() => _build();

  _$ConversationListResponse _build() {
    _$ConversationListResponse _$result;
    try {
      _$result = _$v ?? _$ConversationListResponse._(conversations: conversations.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'conversations';
        conversations.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ConversationListResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
