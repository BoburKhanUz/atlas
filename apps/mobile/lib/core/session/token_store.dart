import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../logging/app_log.dart';
import 'session_tokens.dart';

/// The platform's encrypted key-value store (one string per key).
abstract interface class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Android Keystore / iOS Keychain via flutter_secure_storage.
///
/// * Android: values are AES-256-GCM encrypted with a key wrapped by an RSA
///   key that lives in the Android Keystore (never exported); only
///   ciphertext reaches the app's private storage, which is excluded from
///   backup and device transfer (AndroidManifest + data_extraction_rules).
/// * iOS: a Keychain item, readable after the first unlock since boot
///   (background refresh), never synchronised to iCloud and never restored
///   onto another device (`…ThisDeviceOnly`).
class PlatformSecureKeyValueStore implements SecureKeyValueStore {
  PlatformSecureKeyValueStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage(aOptions: androidOptions, iOptions: iosOptions);

  @visibleForTesting
  static const androidOptions = AndroidOptions(storageNamespace: 'atlas_session');

  @visibleForTesting
  static const iosOptions = IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
    synchronizable: false,
  );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Secure storage could not be read or written. The message never contains
/// a token.
class TokenStorageException implements Exception {
  const TokenStorageException(this.operation, [this.cause]);
  final String operation;
  final Object? cause;
  @override
  String toString() => 'TokenStorageException($operation${cause == null ? '' : ': ${cause.runtimeType}'})';
}

/// Persists the one current [SessionTokens] pair.
///
/// The whole pair is ONE secure-storage entry, so a write replaces access
/// AND refresh token in a single platform operation: a mixed pair
/// (new access + old refresh, or the reverse) cannot be persisted. Every
/// write is read back and compared before it counts as saved.
class TokenStore {
  TokenStore(this._kv, {this._timeout = const Duration(seconds: 5)});

  static const key = 'atlas.session.v1';

  final SecureKeyValueStore _kv;
  final Duration _timeout;

  /// The stored pair, or null when there is none. A stored value that does
  /// not parse is deleted (it can never be used). Throws
  /// [TokenStorageException] when storage itself fails.
  Future<SessionTokens?> read() async {
    final String? raw;
    try {
      raw = await _kv.read(key).timeout(_timeout);
    } on Object catch (e) {
      throw TokenStorageException('read', e);
    }
    if (raw == null || raw.isEmpty) return null;
    try {
      return SessionTokens.decode(raw);
    } on FormatException {
      AppLog.warn('stored session is unreadable; removing it');
      await clear();
      return null;
    }
  }

  /// Replaces the stored pair with [tokens] and verifies it. Throws
  /// [TokenStorageException] when it could not be saved; the previous pair is
  /// then either still stored or (if the platform failed half-way) the read
  /// back shows which one is.
  Future<void> save(SessionTokens tokens) async {
    final encoded = tokens.encode();
    try {
      await _kv.write(key, encoded).timeout(_timeout);
      final back = await _kv.read(key).timeout(_timeout);
      if (back != encoded) throw StateError('read-back mismatch');
    } on Object catch (e) {
      throw TokenStorageException('write', e);
    }
  }

  /// Deletes the pair. Tries twice; throws [TokenStorageException] if the
  /// value is still there afterwards.
  Future<void> clear() async {
    Object? last;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        await _kv.delete(key).timeout(_timeout);
        if (await _kv.read(key).timeout(_timeout) == null) return;
      } on Object catch (e) {
        last = e;
      }
    }
    throw TokenStorageException('delete', last);
  }
}
