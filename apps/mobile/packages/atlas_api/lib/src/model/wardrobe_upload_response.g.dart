// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wardrobe_upload_response.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$WardrobeUploadResponse extends WardrobeUploadResponse {
  @override
  final Detection detection;
  @override
  final WardrobeItem item;

  factory _$WardrobeUploadResponse([void Function(WardrobeUploadResponseBuilder)? updates]) =>
      (WardrobeUploadResponseBuilder()..update(updates))._build();

  _$WardrobeUploadResponse._({required this.detection, required this.item}) : super._();
  @override
  WardrobeUploadResponse rebuild(void Function(WardrobeUploadResponseBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  WardrobeUploadResponseBuilder toBuilder() => WardrobeUploadResponseBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is WardrobeUploadResponse && detection == other.detection && item == other.item;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, detection.hashCode);
    _$hash = $jc(_$hash, item.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'WardrobeUploadResponse')
          ..add('detection', detection)
          ..add('item', item))
        .toString();
  }
}

class WardrobeUploadResponseBuilder implements Builder<WardrobeUploadResponse, WardrobeUploadResponseBuilder> {
  _$WardrobeUploadResponse? _$v;

  DetectionBuilder? _detection;
  DetectionBuilder get detection => _$this._detection ??= DetectionBuilder();
  set detection(DetectionBuilder? detection) => _$this._detection = detection;

  WardrobeItemBuilder? _item;
  WardrobeItemBuilder get item => _$this._item ??= WardrobeItemBuilder();
  set item(WardrobeItemBuilder? item) => _$this._item = item;

  WardrobeUploadResponseBuilder() {
    WardrobeUploadResponse._defaults(this);
  }

  WardrobeUploadResponseBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _detection = $v.detection.toBuilder();
      _item = $v.item.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(WardrobeUploadResponse other) {
    _$v = other as _$WardrobeUploadResponse;
  }

  @override
  void update(void Function(WardrobeUploadResponseBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  WardrobeUploadResponse build() => _build();

  _$WardrobeUploadResponse _build() {
    _$WardrobeUploadResponse _$result;
    try {
      _$result = _$v ?? _$WardrobeUploadResponse._(detection: detection.build(), item: item.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'detection';
        detection.build();
        _$failedField = 'item';
        item.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'WardrobeUploadResponse', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
