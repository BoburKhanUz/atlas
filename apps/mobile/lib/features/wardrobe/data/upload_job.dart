import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'image_preparer.dart';

/// One user upload action: the prepared bytes, their file name and ONE
/// Idempotency-Key. Every retry of the action sends exactly this job; a new
/// key only ever comes with a new photo ([UploadJob.create]).
@immutable
class UploadJob {
  const UploadJob._(this.idempotencyKey, this.image);

  factory UploadJob.create(PreparedImage image, {Random? random}) => UploadJob._(newIdempotencyKey(random), image);

  /// Recovery after an interrupted upload: the SAME prepared payload (hash
  /// and file name verified by the caller) under its earlier key.
  factory UploadJob.recovered(PreparedImage image, String idempotencyKey) => UploadJob._(idempotencyKey, image);

  final String idempotencyKey;
  final PreparedImage image;

  /// 128 random bits, URL-safe base64 without padding (22 characters,
  /// matches `^[A-Za-z0-9_-]{8,128}$`).
  static String newIdempotencyKey([Random? random]) {
    final r = random ?? Random.secure();
    final bytes = List<int>.generate(16, (_) => r.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// The same image under another key — only for tests that provoke
  /// IDEMPOTENCY_KEY_MISMATCH on purpose.
  @visibleForTesting
  UploadJob withKeyForTest(String key) => UploadJob._(key, image);

  /// No key, no bytes.
  @override
  String toString() => 'UploadJob($image)';
}
