import 'dart:async';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import '../network/media_url.dart';
import '../network/providers.dart';
import 'skeleton.dart';

/// Which rendition of a stored image.
enum ImageVariant { display, thumbnail }

/// A signed image reference from an API response (`ImageObject`).
@immutable
class SignedImageRef {
  const SignedImageRef({
    required this.imageId,
    required this.url,
    required this.expiresAt,
    this.variant = ImageVariant.display,
  });

  /// Cache identity together with [variant]. For a generated outfit item
  /// (only a bare `imageUrl`) it is `item:<wardrobe item id>`.
  final String imageId;
  final String url;

  /// Null when the API gives no expiry (generated outfit items): the URL is
  /// then tried, and a rejection asks the owner for a fresh one.
  final DateTime? expiresAt;
  final ImageVariant variant;

  /// Never prints the URL (it is a credential until it expires).
  @override
  String toString() => 'SignedImageRef($imageId, ${variant.name})';
}

/// Loads the bytes of a signed media URL (GET, no Bearer, no cookies).
typedef MediaFetcher = Future<Uint8List> Function(String url);

/// The signed URL could not be loaded (expired, tampered, missing).
/// Carries the status only — never the URL.
class SignedImageLoadException implements Exception {
  const SignedImageLoadException(this.statusCode);
  final int? statusCode;

  /// The URL is no longer valid: get a fresh one by reloading the item.
  bool get urlRejected => statusCode == 400 || statusCode == 403 || statusCode == 404;

  @override
  String toString() => 'SignedImageLoadException(${statusCode ?? 'network'})';
}

/// The media fetcher used by [SignedImage] (the shared Dio: the public media
/// operation has no security requirement, so no Authorization is ever added;
/// relative URLs resolve against the configured API origin; the logging
/// interceptor never logs query strings).
final mediaFetcherProvider = Provider<MediaFetcher>((ref) {
  final dio = ref.watch(dioProvider);
  return (url) async {
    final response = await dio.get<List<int>>(url, options: Options(responseType: ResponseType.bytes));
    return Uint8List.fromList(response.data ?? const []);
  };
});

/// Cache identity: image id + variant. The URL (and its signature) is NOT
/// part of it, so a refreshed URL reuses the decoded image.
@immutable
class SignedImageKey {
  const SignedImageKey(this.imageId, this.variant);
  final String imageId;
  final ImageVariant variant;
  @override
  bool operator ==(Object other) => other is SignedImageKey && other.imageId == imageId && other.variant == variant;
  @override
  int get hashCode => Object.hash(imageId, variant);
  @override
  String toString() => 'SignedImageKey($imageId, ${variant.name})';
}

/// In-memory only (Flutter's ImageCache); nothing is written to disk.
class SignedImageProvider extends ImageProvider<SignedImageKey> {
  const SignedImageProvider(this.ref, this.fetch);
  final SignedImageRef ref;
  final MediaFetcher fetch;

  SignedImageKey get key => SignedImageKey(ref.imageId, ref.variant);

  @override
  Future<SignedImageKey> obtainKey(ImageConfiguration configuration) => SynchronousFuture(key);

  @override
  ImageStreamCompleter loadImage(SignedImageKey key, ImageDecoderCallback decode) =>
      MultiFrameImageStreamCompleter(codec: _load(key, decode), scale: 1);

  Future<ui.Codec> _load(SignedImageKey key, ImageDecoderCallback decode) async {
    try {
      final bytes = await fetch(ref.url);
      if (bytes.isEmpty) throw const SignedImageLoadException(null);
      return await decode(await ui.ImmutableBuffer.fromUint8List(bytes));
    } on SignedImageLoadException {
      _evict(key);
      rethrow;
    } on Object catch (e) {
      _evict(key);
      // Never rethrow the original: Dio errors carry the request URL.
      throw SignedImageLoadException(_statusOf(e));
    }
  }

  static int? _statusOf(Object e) => e is DioException ? e.response?.statusCode : null;

  static void _evict(SignedImageKey key) {
    // A failed load must not stay cached: the next (fresh) URL loads again.
    scheduleMicrotask(() => PaintingBinding.instance.imageCache.evict(key));
  }

  @override
  bool operator ==(Object other) => other is SignedImageProvider && other.key == key;
  @override
  int get hashCode => key.hashCode;
  @override
  String toString() => 'SignedImageProvider(${ref.imageId}, ${ref.variant.name})';
}

/// Shows a signed image. When its URL has expired (60 s margin) or the
/// server rejects it, [onExpired] asks the owner to reload the item for a
/// fresh URL; an already decoded image (same id + variant) keeps showing.
///
/// Without a [semanticLabel] the image is decorative (a thumbnail next to
/// its own text label): it and its placeholders are left out of semantics.
class SignedImage extends ConsumerStatefulWidget {
  const SignedImage({super.key, required this.image, this.onExpired, this.fit = BoxFit.cover, this.semanticLabel});

  final SignedImageRef image;
  final VoidCallback? onExpired;
  final BoxFit fit;
  final String? semanticLabel;

  @override
  ConsumerState<SignedImage> createState() => _SignedImageState();
}

class _SignedImageState extends ConsumerState<SignedImage> {
  bool _reported = false;

  @override
  void didUpdateWidget(SignedImage old) {
    super.didUpdateWidget(old);
    if (old.image.url != widget.image.url) _reported = false;
  }

  void _expired() {
    if (_reported || widget.onExpired == null) return;
    _reported = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onExpired!();
    });
  }

  @override
  Widget build(BuildContext context) {
    final image = _image();
    return widget.semanticLabel == null ? ExcludeSemantics(child: image) : image;
  }

  Widget _image() {
    final provider = SignedImageProvider(widget.image, ref.watch(mediaFetcherProvider));
    final cached = PaintingBinding.instance.imageCache.containsKey(provider.key);
    final expiresAt = widget.image.expiresAt;
    if (!cached && expiresAt != null && !SignedMediaUrl.isUsable(expiresAt)) {
      _expired();
      return const _Placeholder(loading: true);
    }
    return Image(
      image: provider,
      fit: widget.fit,
      semanticLabel: widget.semanticLabel,
      gaplessPlayback: true,
      frameBuilder: (context, child, frame, sync) => frame == null && !sync ? const _Placeholder(loading: true) : child,
      errorBuilder: (context, error, stack) {
        if (error is SignedImageLoadException && error.urlRejected) _expired();
        return const _Placeholder(loading: false);
      },
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.loading});
  final bool loading;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Skeleton(height: double.infinity, radius: 0);
    return const ColoredBox(
      color: AtlasColors.skeleton,
      child: Center(child: Icon(Icons.image_not_supported_outlined, color: AtlasColors.textSecondary)),
    );
  }
}
