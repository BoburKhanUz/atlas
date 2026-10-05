// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'error_response_details_inner.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ErrorResponseDetailsInner extends ErrorResponseDetailsInner {
  @override
  final String message;
  @override
  final String path;

  factory _$ErrorResponseDetailsInner([void Function(ErrorResponseDetailsInnerBuilder)? updates]) =>
      (ErrorResponseDetailsInnerBuilder()..update(updates))._build();

  _$ErrorResponseDetailsInner._({required this.message, required this.path}) : super._();
  @override
  ErrorResponseDetailsInner rebuild(void Function(ErrorResponseDetailsInnerBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ErrorResponseDetailsInnerBuilder toBuilder() => ErrorResponseDetailsInnerBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ErrorResponseDetailsInner && message == other.message && path == other.path;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, message.hashCode);
    _$hash = $jc(_$hash, path.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ErrorResponseDetailsInner')
          ..add('message', message)
          ..add('path', path))
        .toString();
  }
}

class ErrorResponseDetailsInnerBuilder implements Builder<ErrorResponseDetailsInner, ErrorResponseDetailsInnerBuilder> {
  _$ErrorResponseDetailsInner? _$v;

  String? _message;
  String? get message => _$this._message;
  set message(String? message) => _$this._message = message;

  String? _path;
  String? get path => _$this._path;
  set path(String? path) => _$this._path = path;

  ErrorResponseDetailsInnerBuilder() {
    ErrorResponseDetailsInner._defaults(this);
  }

  ErrorResponseDetailsInnerBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _message = $v.message;
      _path = $v.path;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ErrorResponseDetailsInner other) {
    _$v = other as _$ErrorResponseDetailsInner;
  }

  @override
  void update(void Function(ErrorResponseDetailsInnerBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ErrorResponseDetailsInner build() => _build();

  _$ErrorResponseDetailsInner _build() {
    final _$result =
        _$v ??
        _$ErrorResponseDetailsInner._(
          message: BuiltValueNullFieldError.checkNotNull(message, r'ErrorResponseDetailsInner', 'message'),
          path: BuiltValueNullFieldError.checkNotNull(path, r'ErrorResponseDetailsInner', 'path'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
