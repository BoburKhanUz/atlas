// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'client_errors_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ClientErrorsRequest extends ClientErrorsRequest {
  @override
  final BuiltList<ClientErrorReport> reports;

  factory _$ClientErrorsRequest([void Function(ClientErrorsRequestBuilder)? updates]) =>
      (ClientErrorsRequestBuilder()..update(updates))._build();

  _$ClientErrorsRequest._({required this.reports}) : super._();
  @override
  ClientErrorsRequest rebuild(void Function(ClientErrorsRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ClientErrorsRequestBuilder toBuilder() => ClientErrorsRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ClientErrorsRequest && reports == other.reports;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, reports.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ClientErrorsRequest')..add('reports', reports)).toString();
  }
}

class ClientErrorsRequestBuilder implements Builder<ClientErrorsRequest, ClientErrorsRequestBuilder> {
  _$ClientErrorsRequest? _$v;

  ListBuilder<ClientErrorReport>? _reports;
  ListBuilder<ClientErrorReport> get reports => _$this._reports ??= ListBuilder<ClientErrorReport>();
  set reports(ListBuilder<ClientErrorReport>? reports) => _$this._reports = reports;

  ClientErrorsRequestBuilder() {
    ClientErrorsRequest._defaults(this);
  }

  ClientErrorsRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _reports = $v.reports.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ClientErrorsRequest other) {
    _$v = other as _$ClientErrorsRequest;
  }

  @override
  void update(void Function(ClientErrorsRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ClientErrorsRequest build() => _build();

  _$ClientErrorsRequest _build() {
    _$ClientErrorsRequest _$result;
    try {
      _$result = _$v ?? _$ClientErrorsRequest._(reports: reports.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'reports';
        reports.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ClientErrorsRequest', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
