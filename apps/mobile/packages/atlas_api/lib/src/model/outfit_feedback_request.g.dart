// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_feedback_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnum_liked =
    const OutfitFeedbackRequestFeedbackEnum._('liked');
const OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnum_disliked =
    const OutfitFeedbackRequestFeedbackEnum._('disliked');
const OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnum_saved =
    const OutfitFeedbackRequestFeedbackEnum._('saved');
const OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnum_rejected =
    const OutfitFeedbackRequestFeedbackEnum._('rejected');
const OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnum_unknownDefaultOpenApi =
    const OutfitFeedbackRequestFeedbackEnum._('unknownDefaultOpenApi');

OutfitFeedbackRequestFeedbackEnum _$outfitFeedbackRequestFeedbackEnumValueOf(String name) {
  switch (name) {
    case 'liked':
      return _$outfitFeedbackRequestFeedbackEnum_liked;
    case 'disliked':
      return _$outfitFeedbackRequestFeedbackEnum_disliked;
    case 'saved':
      return _$outfitFeedbackRequestFeedbackEnum_saved;
    case 'rejected':
      return _$outfitFeedbackRequestFeedbackEnum_rejected;
    case 'unknownDefaultOpenApi':
      return _$outfitFeedbackRequestFeedbackEnum_unknownDefaultOpenApi;
    default:
      return _$outfitFeedbackRequestFeedbackEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<OutfitFeedbackRequestFeedbackEnum> _$outfitFeedbackRequestFeedbackEnumValues =
    BuiltSet<OutfitFeedbackRequestFeedbackEnum>(const <OutfitFeedbackRequestFeedbackEnum>[
      _$outfitFeedbackRequestFeedbackEnum_liked,
      _$outfitFeedbackRequestFeedbackEnum_disliked,
      _$outfitFeedbackRequestFeedbackEnum_saved,
      _$outfitFeedbackRequestFeedbackEnum_rejected,
      _$outfitFeedbackRequestFeedbackEnum_unknownDefaultOpenApi,
    ]);

Serializer<OutfitFeedbackRequestFeedbackEnum> _$outfitFeedbackRequestFeedbackEnumSerializer =
    _$OutfitFeedbackRequestFeedbackEnumSerializer();

class _$OutfitFeedbackRequestFeedbackEnumSerializer implements PrimitiveSerializer<OutfitFeedbackRequestFeedbackEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'liked': 'liked',
    'disliked': 'disliked',
    'saved': 'saved',
    'rejected': 'rejected',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'liked': 'liked',
    'disliked': 'disliked',
    'saved': 'saved',
    'rejected': 'rejected',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[OutfitFeedbackRequestFeedbackEnum];
  @override
  final String wireName = 'OutfitFeedbackRequestFeedbackEnum';

  @override
  Object serialize(
    Serializers serializers,
    OutfitFeedbackRequestFeedbackEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  OutfitFeedbackRequestFeedbackEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => OutfitFeedbackRequestFeedbackEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$OutfitFeedbackRequest extends OutfitFeedbackRequest {
  @override
  final OutfitFeedbackRequestFeedbackEnum feedback;
  @override
  final String? note;

  factory _$OutfitFeedbackRequest([void Function(OutfitFeedbackRequestBuilder)? updates]) =>
      (OutfitFeedbackRequestBuilder()..update(updates))._build();

  _$OutfitFeedbackRequest._({required this.feedback, this.note}) : super._();
  @override
  OutfitFeedbackRequest rebuild(void Function(OutfitFeedbackRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitFeedbackRequestBuilder toBuilder() => OutfitFeedbackRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitFeedbackRequest && feedback == other.feedback && note == other.note;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, feedback.hashCode);
    _$hash = $jc(_$hash, note.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitFeedbackRequest')
          ..add('feedback', feedback)
          ..add('note', note))
        .toString();
  }
}

class OutfitFeedbackRequestBuilder implements Builder<OutfitFeedbackRequest, OutfitFeedbackRequestBuilder> {
  _$OutfitFeedbackRequest? _$v;

  OutfitFeedbackRequestFeedbackEnum? _feedback;
  OutfitFeedbackRequestFeedbackEnum? get feedback => _$this._feedback;
  set feedback(OutfitFeedbackRequestFeedbackEnum? feedback) => _$this._feedback = feedback;

  String? _note;
  String? get note => _$this._note;
  set note(String? note) => _$this._note = note;

  OutfitFeedbackRequestBuilder() {
    OutfitFeedbackRequest._defaults(this);
  }

  OutfitFeedbackRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _feedback = $v.feedback;
      _note = $v.note;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitFeedbackRequest other) {
    _$v = other as _$OutfitFeedbackRequest;
  }

  @override
  void update(void Function(OutfitFeedbackRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitFeedbackRequest build() => _build();

  _$OutfitFeedbackRequest _build() {
    final _$result =
        _$v ??
        _$OutfitFeedbackRequest._(
          feedback: BuiltValueNullFieldError.checkNotNull(feedback, r'OutfitFeedbackRequest', 'feedback'),
          note: note,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
