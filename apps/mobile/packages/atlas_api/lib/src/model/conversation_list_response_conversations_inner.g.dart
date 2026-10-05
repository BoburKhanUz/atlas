// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation_list_response_conversations_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ConversationListResponseConversationsInner extends ConversationListResponseConversationsInner {
  @override
  final String id;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? lastMessage;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? lastRole;
  @override
  final ColorAnalysisResponseColorProfileContrastLevel? title;
  @override
  final DateTime updatedAt;

  factory _$ConversationListResponseConversationsInner([
    void Function(ConversationListResponseConversationsInnerBuilder)? updates,
  ]) => (ConversationListResponseConversationsInnerBuilder()..update(updates))._build();

  _$ConversationListResponseConversationsInner._({
    required this.id,
    this.lastMessage,
    this.lastRole,
    this.title,
    required this.updatedAt,
  }) : super._();
  @override
  ConversationListResponseConversationsInner rebuild(
    void Function(ConversationListResponseConversationsInnerBuilder) updates,
  ) => (toBuilder()..update(updates)).build();

  @override
  ConversationListResponseConversationsInnerBuilder toBuilder() =>
      ConversationListResponseConversationsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ConversationListResponseConversationsInner &&
        id == other.id &&
        lastMessage == other.lastMessage &&
        lastRole == other.lastRole &&
        title == other.title &&
        updatedAt == other.updatedAt;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, lastMessage.hashCode);
    _$hash = $jc(_$hash, lastRole.hashCode);
    _$hash = $jc(_$hash, title.hashCode);
    _$hash = $jc(_$hash, updatedAt.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ConversationListResponseConversationsInner')
          ..add('id', id)
          ..add('lastMessage', lastMessage)
          ..add('lastRole', lastRole)
          ..add('title', title)
          ..add('updatedAt', updatedAt))
        .toString();
  }
}

class ConversationListResponseConversationsInnerBuilder
    implements Builder<ConversationListResponseConversationsInner, ConversationListResponseConversationsInnerBuilder> {
  _$ConversationListResponseConversationsInner? _$v;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _lastMessage;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get lastMessage =>
      _$this._lastMessage ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set lastMessage(ColorAnalysisResponseColorProfileContrastLevelBuilder? lastMessage) =>
      _$this._lastMessage = lastMessage;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _lastRole;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get lastRole =>
      _$this._lastRole ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set lastRole(ColorAnalysisResponseColorProfileContrastLevelBuilder? lastRole) => _$this._lastRole = lastRole;

  ColorAnalysisResponseColorProfileContrastLevelBuilder? _title;
  ColorAnalysisResponseColorProfileContrastLevelBuilder get title =>
      _$this._title ??= ColorAnalysisResponseColorProfileContrastLevelBuilder();
  set title(ColorAnalysisResponseColorProfileContrastLevelBuilder? title) => _$this._title = title;

  DateTime? _updatedAt;
  DateTime? get updatedAt => _$this._updatedAt;
  set updatedAt(DateTime? updatedAt) => _$this._updatedAt = updatedAt;

  ConversationListResponseConversationsInnerBuilder() {
    ConversationListResponseConversationsInner._defaults(this);
  }

  ConversationListResponseConversationsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _id = $v.id;
      _lastMessage = $v.lastMessage?.toBuilder();
      _lastRole = $v.lastRole?.toBuilder();
      _title = $v.title?.toBuilder();
      _updatedAt = $v.updatedAt;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ConversationListResponseConversationsInner other) {
    _$v = other as _$ConversationListResponseConversationsInner;
  }

  @override
  void update(void Function(ConversationListResponseConversationsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ConversationListResponseConversationsInner build() => _build();

  _$ConversationListResponseConversationsInner _build() {
    _$ConversationListResponseConversationsInner _$result;
    try {
      _$result =
          _$v ??
          _$ConversationListResponseConversationsInner._(
            id: BuiltValueNullFieldError.checkNotNull(id, r'ConversationListResponseConversationsInner', 'id'),
            lastMessage: _lastMessage?.build(),
            lastRole: _lastRole?.build(),
            title: _title?.build(),
            updatedAt: BuiltValueNullFieldError.checkNotNull(
              updatedAt,
              r'ConversationListResponseConversationsInner',
              'updatedAt',
            ),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'lastMessage';
        _lastMessage?.build();
        _$failedField = 'lastRole';
        _lastRole?.build();
        _$failedField = 'title';
        _title?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ConversationListResponseConversationsInner', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
