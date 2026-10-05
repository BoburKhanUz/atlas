// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'stylist_chat_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$StylistChatRequest extends StylistChatRequest {
  @override
  final String? conversationId;
  @override
  final String? event;
  @override
  final String message;
  @override
  final StylistChatRequestWeather? weather;

  factory _$StylistChatRequest([void Function(StylistChatRequestBuilder)? updates]) =>
      (StylistChatRequestBuilder()..update(updates))._build();

  _$StylistChatRequest._({this.conversationId, this.event, required this.message, this.weather}) : super._();
  @override
  StylistChatRequest rebuild(void Function(StylistChatRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  StylistChatRequestBuilder toBuilder() => StylistChatRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is StylistChatRequest &&
        conversationId == other.conversationId &&
        event == other.event &&
        message == other.message &&
        weather == other.weather;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, conversationId.hashCode);
    _$hash = $jc(_$hash, event.hashCode);
    _$hash = $jc(_$hash, message.hashCode);
    _$hash = $jc(_$hash, weather.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'StylistChatRequest')
          ..add('conversationId', conversationId)
          ..add('event', event)
          ..add('message', message)
          ..add('weather', weather))
        .toString();
  }
}

class StylistChatRequestBuilder implements Builder<StylistChatRequest, StylistChatRequestBuilder> {
  _$StylistChatRequest? _$v;

  String? _conversationId;
  String? get conversationId => _$this._conversationId;
  set conversationId(String? conversationId) => _$this._conversationId = conversationId;

  String? _event;
  String? get event => _$this._event;
  set event(String? event) => _$this._event = event;

  String? _message;
  String? get message => _$this._message;
  set message(String? message) => _$this._message = message;

  StylistChatRequestWeatherBuilder? _weather;
  StylistChatRequestWeatherBuilder get weather => _$this._weather ??= StylistChatRequestWeatherBuilder();
  set weather(StylistChatRequestWeatherBuilder? weather) => _$this._weather = weather;

  StylistChatRequestBuilder() {
    StylistChatRequest._defaults(this);
  }

  StylistChatRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _conversationId = $v.conversationId;
      _event = $v.event;
      _message = $v.message;
      _weather = $v.weather?.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(StylistChatRequest other) {
    _$v = other as _$StylistChatRequest;
  }

  @override
  void update(void Function(StylistChatRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  StylistChatRequest build() => _build();

  _$StylistChatRequest _build() {
    _$StylistChatRequest _$result;
    try {
      _$result =
          _$v ??
          _$StylistChatRequest._(
            conversationId: conversationId,
            event: event,
            message: BuiltValueNullFieldError.checkNotNull(message, r'StylistChatRequest', 'message'),
            weather: _weather?.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'weather';
        _weather?.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'StylistChatRequest', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
