import 'package:atlas_api/atlas_api.dart' show MobileAuthResponse;
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/core/session/token_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_session.dart';

void main() {
  group('SessionTokens', () {
    test('encode/decode round-trips every field', () {
      final p = SessionTokens(
        user: const SessionUser(id: 'u1', email: 'a@test.local', name: 'Ali'),
        accessToken: access(1),
        accessTokenExpiresAt: t0.add(const Duration(minutes: 15)),
        refreshToken: refresh(1),
        refreshTokenExpiresAt: t0.add(const Duration(days: 30)),
        sessionExpiresAt: t0.add(const Duration(days: 90)),
        serverClockOffset: const Duration(seconds: -42),
      );
      final back = SessionTokens.decode(p.encode());
      expect(back.user, p.user);
      expect(back.accessToken, p.accessToken);
      expect(back.refreshToken, p.refreshToken);
      expect(back.accessTokenExpiresAt, p.accessTokenExpiresAt);
      expect(back.refreshTokenExpiresAt, p.refreshTokenExpiresAt);
      expect(back.sessionExpiresAt, p.sessionExpiresAt);
      expect(back.serverClockOffset, p.serverClockOffset);
    });

    test('stores exactly the contract fields (plus user and clock offset), nothing else', () {
      final json = pair(1).encode();
      expect(RegExp(r'"(\w+)":').allMatches(json).map((m) => m.group(1)).toSet(), {
        'v',
        'user',
        'id',
        'email',
        'name',
        'accessToken',
        'accessTokenExpiresAt',
        'refreshToken',
        'refreshTokenExpiresAt',
        'sessionExpiresAt',
        'serverClockOffsetMs',
        'accessTokenIssuedAt',
      });
    });

    test('toString never contains a token', () {
      final text = pair(1).toString();
      expect(text, isNot(contains(access(1))));
      expect(text, isNot(contains(refresh(1))));
    });

    test('decode rejects malformed values', () {
      for (final raw in ['', 'x', '{}', '{"v":2}', '{"v":1,"accessToken":3}']) {
        expect(() => SessionTokens.decode(raw), throwsFormatException, reason: raw);
      }
    });

    test('access token counts as expired 30 s early; uses the server clock offset', () {
      final p = pair(1); // access until t0 + 15 min
      expect(p.accessUsableAt(t0.add(const Duration(minutes: 14))), isTrue);
      expect(p.accessUsableAt(t0.add(const Duration(minutes: 14, seconds: 31))), isFalse);
      // Device clock 1 h behind the server: the server's view decides.
      final skewed = SessionTokens.decode(
        pair(1).encode().replaceFirst('"serverClockOffsetMs":0', '"serverClockOffsetMs":3600000'),
      );
      expect(skewed.accessUsableAt(t0), isFalse);
    });

    test('fromMobileAuth measures the server clock offset from the Date header', () {
      final r = MobileAuthResponse(
        (b) => b
          ..user.id = 'u1'
          ..user.email = 'a@test.local'
          ..accessToken = access(1)
          ..accessTokenExpiresAt = t0.add(const Duration(minutes: 15))
          ..refreshToken = refresh(1)
          ..refreshTokenExpiresAt = t0.add(const Duration(days: 30))
          ..sessionExpiresAt = t0.add(const Duration(days: 90)),
      );
      final tokens = SessionTokens.fromMobileAuth(
        r,
        serverDate: t0,
        receivedAt: t0.subtract(const Duration(minutes: 10)), // device 10 min behind
      );
      expect(tokens.serverClockOffset, const Duration(minutes: 10));
      expect(tokens.accessUsableAt(t0.subtract(const Duration(minutes: 10))), isTrue);
      expect(tokens.accessUsableAt(t0.add(const Duration(minutes: 5))), isFalse);
    });

    test('refresh margin: 30 s for normal tokens, a quarter of the lifetime for short ones', () {
      SessionTokens issued(Duration ttl) => SessionTokens(
        user: const SessionUser(id: 'u1', email: 'a@test.local'),
        accessToken: access(1),
        accessTokenExpiresAt: t0.add(ttl),
        refreshToken: refresh(1),
        refreshTokenExpiresAt: t0.add(const Duration(days: 30)),
        sessionExpiresAt: t0.add(const Duration(days: 90)),
        accessTokenIssuedAt: t0,
      );
      expect(issued(const Duration(minutes: 15)).refreshMargin, const Duration(seconds: 30));
      final short = issued(const Duration(seconds: 10));
      expect(short.refreshMargin, const Duration(milliseconds: 2500));
      expect(short.accessUsableAt(t0.add(const Duration(seconds: 7))), isTrue);
      expect(short.accessUsableAt(t0.add(const Duration(seconds: 8))), isFalse);
      // Survives storage.
      expect(SessionTokens.decode(short.encode()).refreshMargin, const Duration(milliseconds: 2500));
    });

    test('a session past its 90-day limit is unusable even if the refresh token is not expired', () {
      final p = pair(1, sessionExpiresAt: t0.add(const Duration(hours: 1)));
      expect(p.unusableAt(t0.add(const Duration(hours: 1))), isTrue);
      expect(p.unusableAt(t0), isFalse);
    });
  });

  group('TokenStore', () {
    test('save then read returns the same pair', () async {
      final kv = MemorySecureStore();
      final store = TokenStore(kv);
      await store.save(pair(1));
      expect((await store.read())?.refreshToken, refresh(1));
    });

    test('read with nothing stored is null', () async {
      expect(await TokenStore(MemorySecureStore()).read(), isNull);
    });

    test('replace writes the complete new pair in ONE entry (no mixed pair possible)', () async {
      final kv = MemorySecureStore();
      final store = TokenStore(kv);
      await store.save(pair(1));
      kv.ops.clear();
      await store.save(pair(2));
      expect(kv.values.keys, [TokenStore.key]);
      expect(kv.ops.where((o) => o == 'write'), hasLength(1));
      expect(kv.ops, isNot(contains('delete')), reason: 'the old pair is replaced, never deleted first');
      final stored = kv.stored!;
      expect((stored.accessToken, stored.refreshToken), (access(2), refresh(2)));
    });

    test('a failed write throws and leaves the previous pair stored', () async {
      final kv = MemorySecureStore();
      final store = TokenStore(kv);
      await store.save(pair(1));
      kv.failWrites = true;
      await expectLater(store.save(pair(2)), throwsA(isA<TokenStorageException>()));
      expect(kv.stored?.refreshToken, refresh(1));
    });

    test('a write that does not read back is a failure', () async {
      final kv = MemorySecureStore()..dropWrites = true;
      await expectLater(TokenStore(kv).save(pair(1)), throwsA(isA<TokenStorageException>()));
    });

    test('delete removes the pair', () async {
      final kv = MemorySecureStore();
      final store = TokenStore(kv);
      await store.save(pair(1));
      await store.clear();
      expect(kv.values, isEmpty);
      expect(await store.read(), isNull);
    });

    test('a failing delete is reported', () async {
      final kv = MemorySecureStore();
      final store = TokenStore(kv);
      await store.save(pair(1));
      kv.failDeletes = true;
      await expectLater(store.clear(), throwsA(isA<TokenStorageException>()));
    });

    test('a failing read is reported (not treated as "no session")', () async {
      final kv = MemorySecureStore()..failReads = true;
      await expectLater(TokenStore(kv).read(), throwsA(isA<TokenStorageException>()));
    });

    test('an unreadable stored value is removed and reads as no session', () async {
      final kv = MemorySecureStore();
      kv.values[TokenStore.key] = 'garbage';
      expect(await TokenStore(kv).read(), isNull);
      expect(kv.values, isEmpty);
    });

    test('exceptions never carry token text', () async {
      final kv = MemorySecureStore()..failWrites = true;
      try {
        await TokenStore(kv).save(pair(1));
        fail('expected a failure');
      } on TokenStorageException catch (e) {
        expect(e.toString(), isNot(contains(access(1))));
        expect(e.toString(), isNot(contains(refresh(1))));
      }
    });
  });

  group('PlatformSecureKeyValueStore', () {
    TestWidgetsFlutterBinding.ensureInitialized();
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    final calls = <MethodCall>[];

    setUp(() {
      calls.clear();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return null;
      });
    });
    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('uses platform secure storage with Keychain "this device only" and no iCloud sync', () async {
      await PlatformSecureKeyValueStore().write('k', 'v');
      final call = calls.single;
      expect(call.method, 'write');
      final options = ((call.arguments as Map)['options'] as Map).cast<String, Object?>();
      // The method channel carries the current platform's options; check both
      // option sets directly as well.
      expect(options, isNotEmpty);
      final ios = PlatformSecureKeyValueStore.iosOptions.toMap();
      expect(ios['accessibility'], 'first_unlock_this_device');
      expect(ios['synchronizable'], 'false');
      final android = PlatformSecureKeyValueStore.androidOptions.toMap();
      expect(android['storageNamespace'], 'atlas_session');
      expect(android['storageCipherAlgorithm'], 'AES_GCM_NoPadding');
      expect(android['keyCipherAlgorithm'], 'RSA_ECB_OAEPwithSHA_256andMGF1Padding');
    });
  });
}
