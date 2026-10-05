// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_summary.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitSummary extends OutfitSummary {
  @override
  final DateTime createdAt;
  @override
  final String? explanation;
  @override
  final String id;
  @override
  final bool isSaved;
  @override
  final BuiltList<OutfitSummaryItem> items;
  @override
  final String? name;
  @override
  final String? occasion;
  @override
  final BuiltList<String> reasons;
  @override
  final int? score;
  @override
  final JsonObject weatherSnapshot;

  factory _$OutfitSummary([void Function(OutfitSummaryBuilder)? updates]) =>
      (OutfitSummaryBuilder()..update(updates))._build();

  _$OutfitSummary._({
    required this.createdAt,
    this.explanation,
    required this.id,
    required this.isSaved,
    required this.items,
    this.name,
    this.occasion,
    required this.reasons,
    this.score,
    required this.weatherSnapshot,
  }) : super._();
  @override
  OutfitSummary rebuild(void Function(OutfitSummaryBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  OutfitSummaryBuilder toBuilder() => OutfitSummaryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitSummary &&
        createdAt == other.createdAt &&
        explanation == other.explanation &&
        id == other.id &&
        isSaved == other.isSaved &&
        items == other.items &&
        name == other.name &&
        occasion == other.occasion &&
        reasons == other.reasons &&
        score == other.score &&
        weatherSnapshot == other.weatherSnapshot;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, createdAt.hashCode);
    _$hash = $jc(_$hash, explanation.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, isSaved.hashCode);
    _$hash = $jc(_$hash, items.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jc(_$hash, occasion.hashCode);
    _$hash = $jc(_$hash, reasons.hashCode);
    _$hash = $jc(_$hash, score.hashCode);
    _$hash = $jc(_$hash, weatherSnapshot.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitSummary')
          ..add('createdAt', createdAt)
          ..add('explanation', explanation)
          ..add('id', id)
          ..add('isSaved', isSaved)
          ..add('items', items)
          ..add('name', name)
          ..add('occasion', occasion)
          ..add('reasons', reasons)
          ..add('score', score)
          ..add('weatherSnapshot', weatherSnapshot))
        .toString();
  }
}

class OutfitSummaryBuilder implements Builder<OutfitSummary, OutfitSummaryBuilder> {
  _$OutfitSummary? _$v;

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

  ListBuilder<OutfitSummaryItem>? _items;
  ListBuilder<OutfitSummaryItem> get items => _$this._items ??= ListBuilder<OutfitSummaryItem>();
  set items(ListBuilder<OutfitSummaryItem>? items) => _$this._items = items;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  String? _occasion;
  String? get occasion => _$this._occasion;
  set occasion(String? occasion) => _$this._occasion = occasion;

  ListBuilder<String>? _reasons;
  ListBuilder<String> get reasons => _$this._reasons ??= ListBuilder<String>();
  set reasons(ListBuilder<String>? reasons) => _$this._reasons = reasons;

  int? _score;
  int? get score => _$this._score;
  set score(int? score) => _$this._score = score;

  JsonObject? _weatherSnapshot;
  JsonObject? get weatherSnapshot => _$this._weatherSnapshot;
  set weatherSnapshot(JsonObject? weatherSnapshot) => _$this._weatherSnapshot = weatherSnapshot;

  OutfitSummaryBuilder() {
    OutfitSummary._defaults(this);
  }

  OutfitSummaryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _createdAt = $v.createdAt;
      _explanation = $v.explanation;
      _id = $v.id;
      _isSaved = $v.isSaved;
      _items = $v.items.toBuilder();
      _name = $v.name;
      _occasion = $v.occasion;
      _reasons = $v.reasons.toBuilder();
      _score = $v.score;
      _weatherSnapshot = $v.weatherSnapshot;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitSummary other) {
    _$v = other as _$OutfitSummary;
  }

  @override
  void update(void Function(OutfitSummaryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitSummary build() => _build();

  _$OutfitSummary _build() {
    _$OutfitSummary _$result;
    try {
      _$result =
          _$v ??
          _$OutfitSummary._(
            createdAt: BuiltValueNullFieldError.checkNotNull(createdAt, r'OutfitSummary', 'createdAt'),
            explanation: explanation,
            id: BuiltValueNullFieldError.checkNotNull(id, r'OutfitSummary', 'id'),
            isSaved: BuiltValueNullFieldError.checkNotNull(isSaved, r'OutfitSummary', 'isSaved'),
            items: items.build(),
            name: name,
            occasion: occasion,
            reasons: reasons.build(),
            score: score,
            weatherSnapshot: BuiltValueNullFieldError.checkNotNull(
              weatherSnapshot,
              r'OutfitSummary',
              'weatherSnapshot',
            ),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'items';
        items.build();

        _$failedField = 'reasons';
        reasons.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'OutfitSummary', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
