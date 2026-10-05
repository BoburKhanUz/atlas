// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outfit_patch_request.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$OutfitPatchRequest extends OutfitPatchRequest {
  @override
  final bool? isSaved;
  @override
  final String? name;

  factory _$OutfitPatchRequest([void Function(OutfitPatchRequestBuilder)? updates]) =>
      (OutfitPatchRequestBuilder()..update(updates))._build();

  _$OutfitPatchRequest._({this.isSaved, this.name}) : super._();
  @override
  OutfitPatchRequest rebuild(void Function(OutfitPatchRequestBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  OutfitPatchRequestBuilder toBuilder() => OutfitPatchRequestBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is OutfitPatchRequest && isSaved == other.isSaved && name == other.name;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, isSaved.hashCode);
    _$hash = $jc(_$hash, name.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'OutfitPatchRequest')
          ..add('isSaved', isSaved)
          ..add('name', name))
        .toString();
  }
}

class OutfitPatchRequestBuilder implements Builder<OutfitPatchRequest, OutfitPatchRequestBuilder> {
  _$OutfitPatchRequest? _$v;

  bool? _isSaved;
  bool? get isSaved => _$this._isSaved;
  set isSaved(bool? isSaved) => _$this._isSaved = isSaved;

  String? _name;
  String? get name => _$this._name;
  set name(String? name) => _$this._name = name;

  OutfitPatchRequestBuilder() {
    OutfitPatchRequest._defaults(this);
  }

  OutfitPatchRequestBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _isSaved = $v.isSaved;
      _name = $v.name;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(OutfitPatchRequest other) {
    _$v = other as _$OutfitPatchRequest;
  }

  @override
  void update(void Function(OutfitPatchRequestBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  OutfitPatchRequest build() => _build();

  _$OutfitPatchRequest _build() {
    final _$result = _$v ?? _$OutfitPatchRequest._(isSaved: isSaved, name: name);
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
