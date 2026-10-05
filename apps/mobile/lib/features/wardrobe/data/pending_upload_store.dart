import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/session/token_store.dart';

/// A record of an upload that was started but not finished — for
/// duplicate-safe interrupted-upload recovery (NOT a resumable upload: the
/// image bytes are never stored, so nothing can continue by itself).
/// If the user later picks the same photo and it prepares to the same bytes
/// (hash) and file name, its Idempotency-Key is reused: a server that already
/// processed the first attempt replays it instead of creating a duplicate.
@immutable
class PendingUpload {
  const PendingUpload({
    required this.userId,
    required this.idempotencyKey,
    required this.sha256,
    required this.filename,
    required this.createdAt,
  });

  final String userId;
  final String idempotencyKey;

  /// SHA-256 of the prepared JPEG bytes (hex).
  final String sha256;
  final String filename;
  final DateTime createdAt;

  /// The backend keeps idempotency results for 24 h.
  static const lifetime = Duration(hours: 24);

  bool expiredAt(DateTime now) => !now.toUtc().isBefore(createdAt.toUtc().add(lifetime));

  /// The same prepared payload (bytes and file name).
  bool matches(String sha256, String filename) => this.sha256 == sha256 && this.filename == filename;

  String encode() => jsonEncode({
    'v': 1,
    'userId': userId,
    'idempotencyKey': idempotencyKey,
    'sha256': sha256,
    'filename': filename,
    'createdAt': createdAt.toUtc().toIso8601String(),
  });

  static PendingUpload? tryDecode(String raw) {
    try {
      final j = jsonDecode(raw) as Map<String, Object?>;
      if (j['v'] != 1) return null;
      return PendingUpload(
        userId: j['userId']! as String,
        idempotencyKey: j['idempotencyKey']! as String,
        sha256: j['sha256']! as String,
        filename: j['filename']! as String,
        createdAt: DateTime.parse(j['createdAt']! as String).toUtc(),
      );
    } on Object {
      return null;
    }
  }

  /// Never prints the key or the hash.
  @override
  String toString() => 'PendingUpload(${createdAt.toIso8601String()})';
}

/// One record per user, in secure storage. Failures are logged (without
/// values) and never block an upload.
class PendingUploadStore {
  PendingUploadStore(this._kv, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final SecureKeyValueStore _kv;
  final DateTime Function() _clock;

  static String keyFor(String userId) => 'atlas.upload.pending.v1.${userId.replaceAll(RegExp('[^A-Za-z0-9_-]'), '_')}';

  /// The user's unexpired record; an expired or unreadable one is deleted.
  Future<PendingUpload?> read(String userId) async {
    final String? raw;
    try {
      raw = await _kv.read(keyFor(userId));
    } on Object catch (e) {
      AppLog.warn('pending upload record unreadable (${e.runtimeType})');
      return null;
    }
    if (raw == null) return null;
    final record = PendingUpload.tryDecode(raw);
    if (record == null || record.userId != userId || record.expiredAt(_clock())) {
      await clear(userId);
      return null;
    }
    return record;
  }

  Future<void> save(PendingUpload record) async {
    try {
      await _kv.write(keyFor(record.userId), record.encode());
    } on Object catch (e) {
      AppLog.warn('pending upload record not saved (${e.runtimeType})');
    }
  }

  Future<void> clear(String userId) async {
    try {
      await _kv.delete(keyFor(userId));
    } on Object catch (e) {
      AppLog.warn('pending upload record not deleted (${e.runtimeType})');
    }
  }
}
