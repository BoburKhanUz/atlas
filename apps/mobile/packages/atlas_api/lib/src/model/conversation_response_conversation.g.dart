// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation_response_conversation.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ConversationResponseConversation extends ConversationResponseConversation {
  @override
  final DateTime createdAt;
  @override
  final String id;
  @override
  final BuiltList<ConversationResponseConversationMessagesInner> messages;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? title;
  @override
  final DateTime updatedAt;

  factory _$ConversationResponseConversation([void Function(ConversationResponseConversationBuilder)? updates]) =>
      (ConversationResponseConversationBuilder()..update(updates))._build();

  _$ConversationResponseConversation._({
    required this.createdAt,
    required this.id,
    required this.messages,
    this.title,
    required this.updatedAt,
  }) : super._();
  @override
  ConversationResponseConversation rebuild(void Function(ConversationResponseConversationBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ConversationResponseConversationBuilder toBuilder() => ConversationResponseConversationBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ConversationResponseConversation &&
        createdAt == other.createdAt &&
        id == other.id &&
        messages == other.messages &&
        title == other.title &&
        updatedAt == other.updatedAt;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, messages.hashCode);
    _$hash = $jc(_$hash, title.hashCode);
    _$hash = $jc(_$hash, updatedAt.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ConversationResponseConversation')
          ..add('createdAt', createdAt)
          ..add('id', id)
          ..add('messages', messages)
          ..add('title', title)
          ..add('updatedAt', updatedAt))
        .toString();
  }
}

class ConversationResponseConversationBuilder
    implements Builder<ConversationResponseConversation, ConversationResponseConversationBuilder> {
  _$ConversationResponseConversation? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ListBuilder<ConversationResponseConversationMessagesInner>? _messages;
  ListBuilder<ConversationResponseConversationMessagesInner> get messages =>
      _$this._messages ??= ListBuilder<ConversationResponseConversationMessagesInner>();
  set messages(ListBuilder<ConversationResponseConversationMessagesInner>? messages) => _$this._messages = messages;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _title;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get title =>
      _$this._title ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set title(ColorAnalysisResponseColorProfileContrastLevelBuilder? title) => _$this._title = title;

  DateTime? _updatedAt;
  DateTime? get updatedAt => _$this._updatedAt;
  set updatedAt(DateTime? updatedAt) => _$this._updatedAt = updatedAt;

  ConversationResponseConversationBuilder() {
    ConversationResponseConversation._defaults(this);
  }

  ConversationResponseConversationBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _id = $v.id;
      _messages = $v.messages.toBuilder();
      _title = $v.title?.toBuilder();
      _updatedAt = $v.updatedAt;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ConversationResponseConversation other) {
    _$v = other as _$ConversationResponseConversation;
  }

  @override
  void update(void Function(ConversationResponseConversationBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ConversationResponseConversation build() => _build();

  _$ConversationResponseConversation _build() {
    _$ConversationResponseConversation _$result;
    try {
      _$result =
          _$v ??
          _$ConversationResponseConversation._(
            createdAt: BuiltValueNullFieldError.checkNotNull(
              createdAt,
              r'ConversationResponseConversation',
              'createdAt',
            ),
            id: BuiltValueNullFieldError.checkNotNull(id, r'ConversationResponseConversation', 'id'),
            messages: messages.build(),
            title: _title?.build(),
            updatedAt: BuiltValueNullFieldError.checkNotNull(
              updatedAt,
              r'ConversationResponseConversation',
              'updatedAt',
            ),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'messages';
        messages.build();
        _$failedField = 'title';
        _title?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ConversationResponseConversation', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
