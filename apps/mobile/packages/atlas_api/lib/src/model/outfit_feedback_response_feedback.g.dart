// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_feedback_response_feedback.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitFeedbackResponseFeedback extends OutfitFeedbackResponseFeedback {
  @override
  final DateTime createdAt;
  @override
  final String feedback;
  @override
  final String id;
  @override
  final String? note;
  @override
  final String outfitId;

  factory _$OutfitFeedbackResponseFeedback([void Function(OutfitFeedbackResponseFeedbackBuilder)? updates]) =>
      (OutfitFeedbackResponseFeedbackBuilder()..update(updates))._build();

  _$OutfitFeedbackResponseFeedback._({
    required this.createdAt,
    required this.feedback,
    required this.id,
    this.note,
    required this.outfitId,
  }) : super._();
  @override
  OutfitFeedbackResponseFeedback rebuild(void Function(OutfitFeedbackResponseFeedbackBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitFeedbackResponseFeedbackBuilder toBuilder() => OutfitFeedbackResponseFeedbackBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitFeedbackResponseFeedback &&
        createdAt == other.createdAt &&
        feedback == other.feedback &&
        id == other.id &&
        note == other.note &&
        outfitId == other.outfitId;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, feedback.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, note.hashCode);
    _$hash = $jc(_$hash, outfitId.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitFeedbackResponseFeedback')
          ..add('createdAt', createdAt)
          ..add('feedback', feedback)
          ..add('id', id)
          ..add('note', note)
          ..add('outfitId', outfitId))
        .toString();
  }
}

class OutfitFeedbackResponseFeedbackBuilder
    implements Builder<OutfitFeedbackResponseFeedback, OutfitFeedbackResponseFeedbackBuilder> {
  _$OutfitFeedbackResponseFeedback? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _feedback;
  String? get feedback => _$this._feedback;
  set feedback(String? feedback) => _$this._feedback = feedback;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  String? _note;
  String? get note => _$this._note;
  set note(String? note) => _$this._note = note;

  String? _outfitId;
  String? get outfitId => _$this._outfitId;
  set outfitId(String? outfitId) => _$this._outfitId = outfitId;

  OutfitFeedbackResponseFeedbackBuilder() {
    OutfitFeedbackResponseFeedback._defaults(this);
  }

  OutfitFeedbackResponseFeedbackBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _feedback = $v.feedback;
      _id = $v.id;
      _note = $v.note;
      _outfitId = $v.outfitId;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitFeedbackResponseFeedback other) {
    _$v = other as _$OutfitFeedbackResponseFeedback;
  }

  @override
  void update(void Function(OutfitFeedbackResponseFeedbackBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitFeedbackResponseFeedback build() => _build();

  _$OutfitFeedbackResponseFeedback _build() {
    final _$result =
        _$v ??
        _$OutfitFeedbackResponseFeedback._(
          createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'OutfitFeedbackResponseFeedback', 'createdAt'),
          feedback: BuiltValueNullFieldError.checkNotNull(feedback, r'OutfitFeedbackResponseFeedback', 'feedback'),
          id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitFeedbackResponseFeedback', 'id'),
          note: note,
          outfitId: BuiltValueNullFieldError.checkNotNull(outfitId, r'OutfitFeedbackResponseFeedback', 'outfitId'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
