// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_row.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitRow extends OutfitRow {
  @override
  final DateTime createdAt;
  @override
  final String? explanation;
  @override
  final String id;
  @override
  final bool isSaved;
  @override
  final String? name;
  @override
  final String? occasion;
  @override
  final int? score;
  @override
  final DateTime updatedAt;

  factory _$OutfitRow([void Function(OutfitRowBuilder)? updates]) => (OutfitRowBuilder()..update(updates))._build();

  _$OutfitRow._({
    required this.createdAt,
    this.explanation,
    required this.id,
    required this.isSaved,
    this.name,
    this.occasion,
    this.score,
    required this.updatedAt,
  }) : super._();
  @override
  OutfitRow rebuild(void Function(OutfitRowBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitRowBuilder toBuilder() => OutfitRowBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitRow &&
        createdAt == other.createdAt &&
        explanation == other.explanation &&
        id == other.id &&
        isSaved == other.isSaved &&
        name == other.name &&
        occasion == other.occasion &&
        score == other.score &&
        updatedAt == other.updatedAt;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, explanation.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, isSaved.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, score.hashCode);
    _$hash = $jc(_$hash, updatedAt.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitRow')
          ..add('createdAt', createdAt)
          ..add('explanation', explanation)
          ..add('id', id)
          ..add('isSaved', isSaved)
          ..add('name', name)
          ..add('occasion', occasion)
          ..add('score', score)
          ..add('updatedAt', updatedAt))
        .toString();
  }
}

class OutfitRowBuilder implements Builder<OutfitRow, OutfitRowBuilder> {
  _$OutfitRow? _$v;

  DateTime? _createdAt;
  DateTime? get createdAt => _$this._createdAt;
  set createdAt(DateTime? createdAt) => _$this._createdAt = createdAt;

  String? _explanation;
  String? get explanation => _$this._explanation;
  set explanation(String? explanation) => _$this._explanation = explanation;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  bool? _isSaved;
  bool? get isSaved => _$this._isSaved;
  set isSaved(bool? isSaved) => _$this._isSaved = isSaved;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  String? _occasion;
  String? get occasion => _$this._occasion;
  set occasion(String? occasion) => _$this._occasion = occasion;

  int? _score;
  int? get score => _$this._score;
  set score(int? score) => _$this._score = score;

  DateTime? _updatedAt;
  DateTime? get updatedAt => _$this._updatedAt;
  set updatedAt(DateTime? updatedAt) => _$this._updatedAt = updatedAt;

  OutfitRowBuilder() {
    OutfitRow._defaults(this);
  }

  OutfitRowBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _explanation = $v.explanation;
      _id = $v.id;
      _isSaved = $v.isSaved;
      _name = $v.name;
      _occasion = $v.occasion;
      _score = $v.score;
      _updatedAt = $v.updatedAt;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitRow other) {
    _$v = other as _$OutfitRow;
  }

  @override
  void update(void Function(OutfitRowBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitRow build() => _build();

  _$OutfitRow _build() {
    final _$result =
        _$v ??
        _$OutfitRow._(
          createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'OutfitRow', 'createdAt'),
          explanation: explanation,
          id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitRow', 'id'),
          isSaved: BuiltValueNullFieldError.checkNotNull(isSaved, r'OutfitRow', 'isSaved'),
          name: name,
          occasion: occasion,
          score: score,
          updatedAt: BuiltValueNullFieldError.checkNotNull(updatedAt, r'OutfitRow', 'updatedAt'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
