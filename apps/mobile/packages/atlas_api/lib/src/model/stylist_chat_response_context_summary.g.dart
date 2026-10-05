// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'stylist_chat_response_context_summary.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$StylistChatResponseContextSummary extends StylistChatResponseContextSummary {
  @override
  final bool eventProvided;
  @override
  final int wardrobeItemCount;
  @override
  final bool weatherProvided;

  factory _$StylistChatResponseContextSummary([void Function(StylistChatResponseContextSummaryBuilder)? updates]) =>
      (StylistChatResponseContextSummaryBuilder()..update(updates))._build();

  _$StylistChatResponseContextSummary._({
    required this.eventProvided,
    required this.wardrobeItemCount,
    required this.weatherProvided,
  }) : super._();
  @override
  StylistChatResponseContextSummary rebuild(void Function(StylistChatResponseContextSummaryBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  StylistChatResponseContextSummaryBuilder toBuilder() => StylistChatResponseContextSummaryBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is StylistChatResponseContextSummary &&
        eventProvided == other.eventProvided &&
        wardrobeItemCount == other.wardrobeItemCount &&
        weatherProvided == other.weatherProvided;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, eventProvided.hashCode);
    _$hash = $jc(_$hash, wardrobeItemCount.hashCode);
    _$hash = $jc(_$hash, weatherProvided.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'StylistChatResponseContextSummary')
          ..add('eventProvided', eventProvided)
          ..add('wardrobeItemCount', wardrobeItemCount)
          ..add('weatherProvided', weatherProvided))
        .toString();
  }
}

class StylistChatResponseContextSummaryBuilder
    implements Builder<StylistChatResponseContextSummary, StylistChatResponseContextSummaryBuilder> {
  _$StylistChatResponseContextSummary? _$v;

  bool? _eventProvided;
  bool? get eventProvided => _$this._eventProvided;
  set eventProvided(bool? eventProvided) => _$this._eventProvided = eventProvided;

  int? _wardrobeItemCount;
  int? get wardrobeItemCount => _$this._wardrobeItemCount;
  set wardrobeItemCount(int? wardrobeItemCount) => _$this._wardrobeItemCount = wardrobeItemCount;

  bool? _weatherProvided;
  bool? get weatherProvided => _$this._weatherProvided;
  set weatherProvided(bool? weatherProvided) => _$this._weatherProvided = weatherProvided;

  StylistChatResponseContextSummaryBuilder() {
    StylistChatResponseContextSummary._defaults(this);
  }

  StylistChatResponseContextSummaryBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _eventProvided = $v.eventProvided;
      _wardrobeItemCount = $v.wardrobeItemCount;
      _weatherProvided = $v.weatherProvided;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(StylistChatResponseContextSummary other) {
    _$v = other as _$StylistChatResponseContextSummary;
  }

  @override
  void update(void Function(StylistChatResponseContextSummaryBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  StylistChatResponseContextSummary build() => _build();

  _$StylistChatResponseContextSummary _build() {
    final _$result =
        _$v ??
        _$StylistChatResponseContextSummary._(
          eventProvided: BuiltValueNullFieldError.checkNotNull(
            eventProvided,
            r'StylistChatResponseContextSummary',
            'eventProvided',
          ),
          wardrobeItemCount: BuiltValueNullFieldError.checkNotNull(
            wardrobeItemCount,
            r'StylistChatResponseContextSummary',
            'wardrobeItemCount',
          ),
          weatherProvided: BuiltValueNullFieldError.checkNotNull(
            weatherProvided,
            r'StylistChatResponseContextSummary',
            'weatherProvided',
          ),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
