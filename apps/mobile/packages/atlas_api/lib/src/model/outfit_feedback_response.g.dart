// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_feedback_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitFeedbackResponse extends OutfitFeedbackResponse {
  @override
  final OutfitFeedbackResponseFeedback feedback;

  factory _$OutfitFeedbackResponse([void Function(OutfitFeedbackResponseBuilder)? updates]) =>
      (OutfitFeedbackResponseBuilder()..update(updates))._build();

  _$OutfitFeedbackResponse._({required this.feedback}) : super._();
  @override
  OutfitFeedbackResponse rebuild(void Function(OutfitFeedbackResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitFeedbackResponseBuilder toBuilder() => OutfitFeedbackResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitFeedbackResponse && feedback == other.feedback;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, feedback.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitFeedbackResponse')..add('feedback', feedback)).toString();
  }
}

class OutfitFeedbackResponseBuilder implements Builder<OutfitFeedbackResponse, OutfitFeedbackResponseBuilder> {
  _$OutfitFeedbackResponse? _$v;

  OutfitFeedbackResponseFeedbackBuilder? _feedback;
  OutfitFeedbackResponseFeedbackBuilder get feedback => _$this._feedback ??= OutfitFeedbackResponseFeedbackBuilder();
  set feedback(OutfitFeedbackResponseFeedbackBuilder? feedback) => _$this._feedback = feedback;

  OutfitFeedbackResponseBuilder() {
    OutfitFeedbackResponse._defaults(this);
  }

  OutfitFeedbackResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _feedback = $v.feedback.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitFeedbackResponse other) {
    _$v = other as _$OutfitFeedbackResponse;
  }

  @override
  void update(void Function(OutfitFeedbackResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitFeedbackResponse build() => _build();

  _$OutfitFeedbackResponse _build() {
    _$OutfitFeedbackResponse _$result;
    try {
      _$result = _$v ?? _$OutfitFeedbackResponse._(feedback: feedback.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'feedback';
        feedback.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitFeedbackResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
