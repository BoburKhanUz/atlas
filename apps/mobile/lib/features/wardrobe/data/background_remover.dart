import 'dart:io' show Platform;

import 'package:flutter/services.dart';

import '../../../core/logging/app_log.dart';

/// Removes the background of a garment photo on the phone, before upload.
abstract interface class BackgroundRemover {
  /// The garment on a plain light background, cropped to it (JPEG); null
  /// when removal is not available or found no garment — the caller then
  /// keeps the original photo.
  Future<Uint8List?> cutout(Uint8List photo);
}

/// Android: ML Kit subject segmentation over a channel
/// (android/…/SubjectCutout.kt); the photo never leaves the phone. Other
/// platforms have no removal yet.
class PlatformBackgroundRemover implements BackgroundRemover {
  const PlatformBackgroundRemover();

  static const _channel = MethodChannel('uz.atlas.app/subject_cutout');

  /// The native side has its own 20 s limit; this one covers a stuck channel.
  static const timeout = Duration(seconds: 25);

  @override
  Future<Uint8List?> cutout(Uint8List photo) async {
    if (!Platform.isAndroid) return null;
    try {
      final result = await _channel.invokeMethod<Uint8List>('cutout', photo).timeout(timeout);
      if (result == null) AppLog.info('background kept: no garment found or the model is not ready');
      return result;
    } on Object catch (e) {
      AppLog.info('background removal unavailable (${e.runtimeType})');
      return null;
    }
  }
}
