// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'stylist_chat_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$StylistChatResponse extends StylistChatResponse {
  @override
  final String assistantMessage;
  @override
  final StylistChatResponseContextSummary contextSummary;
  @override
  final String conversationId;

  factory _$StylistChatResponse([void Function(StylistChatResponseBuilder)? updates]) =>
      (StylistChatResponseBuilder()..update(updates))._build();

  _$StylistChatResponse._({required this.assistantMessage, required this.contextSummary, required this.conversationId})
    : super._();
  @override
  StylistChatResponse rebuild(void Function(StylistChatResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  StylistChatResponseBuilder toBuilder() => StylistChatResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is StylistChatResponse &&
        assistantMessage == other.assistantMessage &&
        contextSummary == other.contextSummary &&
        conversationId == other.conversationId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, assistantMessage.hashCode);
    _$hash = $jc(_$hash, contextSummary.hashCode);
    _$hash = $jc(_$hash, conversationId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'StylistChatResponse')
          ..add('assistantMessage', assistantMessage)
          ..add('contextSummary', contextSummary)
          ..add('conversationId', conversationId))
        .toString();
  }
}

class StylistChatResponseBuilder implements Builder<StylistChatResponse, StylistChatResponseBuilder> {
  _$StylistChatResponse? _$v;

  String? _assistantMessage;
  String? get assistantMessage => _$this._assistantMessage;
  set assistantMessage(String? assistantMessage) => _$this._assistantMessage = assistantMessage;

  StylistChatResponseContextSummaryBuilder? _contextSummary;
  StylistChatResponseContextSummaryBuilder get contextSummary =>
      _$this._contextSummary ??= StylistChatResponseContextSummaryBuilder();
  set contextSummary(StylistChatResponseContextSummaryBuilder? contextSummary) =>
      _$this._contextSummary = contextSummary;

  String? _conversationId;
  String? get conversationId => _$this._conversationId;
  set conversationId(String? conversationId) => _$this._conversationId = conversationId;

  StylistChatResponseBuilder() {
    StylistChatResponse._defaults(this);
  }

  StylistChatResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _assistantMessage = $v.assistantMessage;
      _contextSummary = $v.contextSummary.toBuilder();
      _conversationId = $v.conversationId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(StylistChatResponse other) {
    _$v = other as _$StylistChatResponse;
  }

  @override
  void update(void Function(StylistChatResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  StylistChatResponse build() => _build();

  _$StylistChatResponse _build() {
    _$StylistChatResponse _$result;
    try {
      _$result =
          _$v ??
          _$StylistChatResponse._(
            assistantMessage: BuiltValueNullFieldError.checkNotNull(
              assistantMessage,
              r'StylistChatResponse',
              'assistantMessage',
            ),
            contextSummary: contextSummary.build(),
            conversationId: BuiltValueNullFieldError.checkNotNull(
              conversationId,
              r'StylistChatResponse',
              'conversationId',
            ),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'contextSummary';
        contextSummary.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'StylistChatResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
