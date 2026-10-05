import 'dart:io';

import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/logging/app_log.dart';

enum PhotoSource { camera, gallery }

/// A photo as the system picker returned it (still unprepared).
class PickedPhoto {
  const PickedPhoto(this.bytes, this.name);
  final Uint8List bytes;
  final String name;

  @override
  String toString() => 'PickedPhoto(${bytes.length} bytes)';
}

/// Camera/gallery permission was refused.
class PhotoAccessDenied implements Exception {
  const PhotoAccessDenied(this.source);
  final PhotoSource source;
}

abstract interface class PhotoPicker {
  /// Null when the user cancelled. Permission is asked by the system only
  /// now, when the user chose [source].
  Future<PickedPhoto?> pick(PhotoSource source);

  /// Android: a photo taken while the system killed the app (camera
  /// activity) is delivered after the restart. Null when there is none.
  Future<PickedPhoto?> recoverLost();
}

/// The system camera / photo picker (image_picker). No size or quality
/// options: preparation happens in our own pipeline. `requestFullMetadata:
/// false` avoids the iOS photo-library permission and the metadata copy.
class PlatformPhotoPicker implements PhotoPicker {
  PlatformPhotoPicker([ImagePicker? picker]) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  @override
  Future<PickedPhoto?> pick(PhotoSource source) async {
    final XFile? file;
    try {
      file = await _picker.pickImage(
        source: source == PhotoSource.camera ? ImageSource.camera : ImageSource.gallery,
        requestFullMetadata: false,
      );
    } on PlatformException catch (e) {
      if (e.code.contains('access_denied')) throw PhotoAccessDenied(source);
      rethrow;
    }
    if (file == null) return null;
    return _read(file);
  }

  @override
  Future<PickedPhoto?> recoverLost() async {
    if (!Platform.isAndroid) return null;
    try {
      final lost = await _picker.retrieveLostData();
      if (lost.isEmpty) return null;
      final file = lost.file;
      return file == null ? null : await _read(file);
    } on Object catch (e) {
      AppLog.info('no lost photo recovered (${e.runtimeType})');
      return null;
    }
  }

  Future<PickedPhoto> _read(XFile file) async {
    final bytes = await file.readAsBytes();
    // The picker's temporary copy is not kept: the photo lives in memory
    // only until it is uploaded or discarded.
    try {
      await File(file.path).delete();
    } on Object catch (e) {
      AppLog.info('picker temp file not deleted (${e.runtimeType})');
    }
    return PickedPhoto(bytes, file.name);
  }
}
