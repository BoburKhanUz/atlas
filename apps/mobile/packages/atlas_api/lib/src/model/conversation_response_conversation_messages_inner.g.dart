// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation_response_conversation_messages_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ConversationResponseConversationMessagesInner extends ConversationResponseConversationMessagesInner {
  @override
  final String content;
  @override
  final DateTime createdAt;
  @override
  final String id;
  @override
  final String role;

  factory _$ConversationResponseConversationMessagesInner([
    void Function(ConversationResponseConversationMessagesInnerBuilder)? updates,
  ]) => (ConversationResponseConversationMessagesInnerBuilder()..update(updates))._build();

  _$ConversationResponseConversationMessagesInner._({
    required this.content,
    required this.createdAt,
    required this.id,
    required this.role,
  }) : super._();
  @override
  ConversationResponseConversationMessagesInner rebuild(
    void Function(ConversationResponseConversationMessagesInnerBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  ConversationResponseConversationMessagesInnerBuilder toBuilder() =>
      ConversationResponseConversationMessagesInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ConversationResponseConversationMessagesInner &&
        content == other.content &&
        createdAt == other.createdAt &&
        id == other.id &&
        role == other.role;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, content.hashCode);
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, role.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ConversationResponseConversationMessagesInner')
          ..add('content', content)
          ..add('createdAt', createdAt)
          ..add('id', id)
          ..add('role', role))
        .toString();
  }
}

class ConversationResponseConversationMessagesInnerBuilder
    implements
        Builder<ConversationResponseConversationMessagesInner, ConversationResponseConversationMessagesInnerBuilder> {
  _$ConversationResponseConversationMessagesInner? _$v;

  String? _content;
  String? get content => _$this._content;
  set content(String? content) => _$this._content = content;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _role;
  String? get role => _$this._role;
  set role(String? role) => _$this._role = role;

  ConversationResponseConversationMessagesInnerBuilder() {
    ConversationResponseConversationMessagesInner._defaults(this);
  }

  ConversationResponseConversationMessagesInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _content = $v.content;
      _createdAt = $v.createdAt;
      _id = $v.id;
      _role = $v.role;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ConversationResponseConversationMessagesInner other) {
    _$v = other as _$ConversationResponseConversationMessagesInner;
  }

  @override
  void update(void Function(ConversationResponseConversationMessagesInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ConversationResponseConversationMessagesInner build() => _build();

  _$ConversationResponseConversationMessagesInner _build() {
    final _$result =
        _$v ??
        _$ConversationResponseConversationMessagesInner._(
          content: BuiltValueNullFieldError.checkNotNull(
            content,
            r'ConversationResponseConversationMessagesInner',
            'content',
          ),
          createdAt: BuiltValueNullFieldError.checkNotNull(
            createdAt,
            r'ConversationResponseConversationMessagesInner',
            'createdAt',
          ),
          id: BuiltValueNullFieldError.checkNotNull(id, r'ConversationResponseConversationMessagesInner', 'id'),
          role: BuiltValueNullFieldError.checkNotNull(role, r'ConversationResponseConversationMessagesInner', 'role'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
