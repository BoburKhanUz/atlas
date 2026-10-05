// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'image_object.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ImageObject extends ImageObject {
  @override
  final int? height;
  @override
  final String id;
  @override
  final bool isPrimary;
  @override
  final String? thumbnailUrl;
  @override
  final String url;
  @override
  final DateTime urlExpiresAt;
  @override
  final int? width;

  factory _$ImageObject([void Function(ImageObjectBuilder)? updates]) =>
      (ImageObjectBuilder()..update(updates))._build();

  _$ImageObject._({
    this.height,
    required this.id,
    required this.isPrimary,
    this.thumbnailUrl,
    required this.url,
    required this.urlExpiresAt,
    this.width,
  }) : super._();
  @override
  ImageObject rebuild(void Function(ImageObjectBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ImageObjectBuilder toBuilder() => ImageObjectBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ImageObject &&
        height == other.height &&
        id == other.id &&
        isPrimary == other.isPrimary &&
        thumbnailUrl == other.thumbnailUrl &&
        url == other.url &&
        urlExpiresAt == other.urlExpiresAt &&
        width == other.width;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, height.hashCode);
    _$hash = $jc(_$hash, id.hashCode);
    _$hash = $jc(_$hash, isPrimary.hashCode);
    _$hash = $jc(_$hash, thumbnailUrl.hashCode);
    _$hash = $jc(_$hash, url.hashCode);
    _$hash = $jc(_$hash, urlExpiresAt.hashCode);
    _$hash = $jc(_$hash, width.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ImageObject')
          ..add('height', height)
          ..add('id', id)
          ..add('isPrimary', isPrimary)
          ..add('thumbnailUrl', thumbnailUrl)
          ..add('url', url)
          ..add('urlExpiresAt', urlExpiresAt)
          ..add('width', width))
        .toString();
  }
}

class ImageObjectBuilder implements Builder<ImageObject, ImageObjectBuilder> {
  _$ImageObject? _$v;

  int? _height;
  int? get height => _$this._height;
  set height(int? height) => _$this._height = height;

  String? _id;
  String? get id => _$this._id;
  set id(String? id) => _$this._id = id;

  bool? _isPrimary;
  bool? get isPrimary => _$this._isPrimary;
  set isPrimary(bool? isPrimary) => _$this._isPrimary = isPrimary;

  String? _thumbnailUrl;
  String? get thumbnailUrl => _$this._thumbnailUrl;
  set thumbnailUrl(String? thumbnailUrl) => _$this._thumbnailUrl = thumbnailUrl;

  String? _url;
  String? get url => _$this._url;
  set url(String? url) => _$this._url = url;

  DateTime? _urlExpiresAt;
  DateTime? get urlExpiresAt => _$this._urlExpiresAt;
  set urlExpiresAt(DateTime? urlExpiresAt) => _$this._urlExpiresAt = urlExpiresAt;

  int? _width;
  int? get width => _$this._width;
  set width(int? width) => _$this._width = width;

  ImageObjectBuilder() {
    ImageObject._defaults(this);
  }

  ImageObjectBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _height = $v.height;
      _id = $v.id;
      _isPrimary = $v.isPrimary;
      _thumbnailUrl = $v.thumbnailUrl;
      _url = $v.url;
      _urlExpiresAt = $v.urlExpiresAt;
      _width = $v.width;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ImageObject other) {
    _$v = other as _$ImageObject;
  }

  @override
  void update(void Function(ImageObjectBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ImageObject build() => _build();

  _$ImageObject _build() {
    final _$result =
        _$v ??
        _$ImageObject._(
          height: height,
          id: BuiltValueNullFieldError.checkNotNull(id, r'ImageObject', 'id'),
          isPrimary: BuiltValueNullFieldError.checkNotNull(isPrimary, r'ImageObject', 'isPrimary'),
          thumbnailUrl: thumbnailUrl,
          url: BuiltValueNullFieldError.checkNotNull(url, r'ImageObject', 'url'),
          urlExpiresAt: BuiltValueNullFieldError.checkNotNull(urlExpiresAt, r'ImageObject', 'urlExpiresAt'),
          width: width,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
