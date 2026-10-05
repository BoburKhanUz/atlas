import 'dart:convert';
import 'dart:io';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  AtlasEnvironmentConfig make(String env, String url, {bool release = false}) =>
      AtlasEnvironmentConfig.fromValues(environment: env, apiBaseUrl: url, releaseBuild: release);

  group('development', () {
    test('accepts the local http backend (emulator host)', () {
      final c = make('development', 'http://10.0.2.2:3000');
      expect(c.environment, AtlasEnvironment.development);
      expect(c.apiBaseUrl.toString(), 'http://10.0.2.2:3000');
      expect(c.isProduction, isFalse);
    });

    test('debug flag and verbose logging only in a development debug build', () {
      expect(make('development', 'http://localhost:3000').debug, isTrue);
      expect(make('development', 'http://localhost:3000').logPolicy, LogPolicy.verbose);
      final release = make('development', 'http://localhost:3000', release: true);
      expect(release.debug, isFalse);
      expect(release.logPolicy, LogPolicy.off);
    });
  });

  group('staging', () {
    test('requires https', () {
      expect(() => make('staging', 'http://staging.example.com'), throwsA(isA<AtlasConfigError>()));
    });
    test('https accepted; warnings-only logging, no debug features', () {
      final c = make('staging', 'https://staging.example.com');
      expect(c.debug, isFalse);
      expect(c.logPolicy, LogPolicy.warnings);
    });
  });

  group('production', () {
    test('requires https', () {
      expect(() => make('production', 'http://api.example.com'), throwsA(isA<AtlasConfigError>()));
    });
    test('never logs and has no debug features, even in a debug build', () {
      final c = make('production', 'https://api.example.com');
      expect(c.isProduction, isTrue);
      expect(c.debug, isFalse);
      expect(c.logPolicy, LogPolicy.off);
    });
    test('rejects local/private hosts', () {
      for (final host in ['localhost', '127.0.0.1', '10.0.2.2', '192.168.1.5', 'atlas.local']) {
        expect(() => make('production', 'https://$host'), throwsA(isA<AtlasConfigError>()), reason: host);
      }
    });
  });

  test('a trailing slash is normalised away; ports are kept', () {
    expect(make('production', 'https://api.example.com/').apiBaseUrl.toString(), 'https://api.example.com');
    expect(make('staging', 'https://api.example.com:8443').apiBaseUrl.toString(), 'https://api.example.com:8443');
  });

  test('rejects missing, relative, non-http, path, query, fragment and credential URLs', () {
    for (final bad in [
      '',
      '   ',
      'api.example.com',
      '/api',
      'ftp://x.example',
      'https://x.example/api',
      'https://x.example?q=1',
      'https://u:p@x.example',
      'https://x.example#f',
    ]) {
      expect(() => make('development', bad), throwsA(isA<AtlasConfigError>()), reason: bad);
    }
  });

  test('unknown environment is rejected', () {
    expect(() => make('prod', 'https://x.example'), throwsA(isA<AtlasConfigError>()));
  });

  test('fromEnvironment without defines fails fast (no silent default backend)', () {
    expect(AtlasEnvironmentConfig.fromEnvironment, throwsA(isA<AtlasConfigError>()));
  });

  test('network timeouts and retry policy defaults match the documented contract', () {
    final c = make('development', 'http://localhost:3000');
    expect(c.timeouts.connect, const Duration(seconds: 10));
    expect(c.timeouts.refresh, const Duration(seconds: 12)); // client-recovery-vectors
    expect(c.retry.networkRetryDelays, const [Duration(seconds: 1), Duration(seconds: 2)]);
    expect(c.retry.networkRetryWindow, const Duration(seconds: 45));
    expect(c.retry.busyMaxRetries, 2); // 3 attempts in total
  });

  group('committed config files', () {
    Map<String, Object?> read(String f) => jsonDecode(File('config/$f').readAsStringSync()) as Map<String, Object?>;

    test('development.json is valid and points at a local backend', () {
      final j = read('development.json');
      final c = make(j['ATLAS_ENV']! as String, j['ATLAS_API_BASE_URL']! as String);
      expect(c.environment, AtlasEnvironment.development);
    });

    test('staging/production examples are valid https configs with placeholder hosts', () {
      for (final f in ['staging.example.json', 'production.example.json']) {
        final j = read(f);
        final c = make(j['ATLAS_ENV']! as String, j['ATLAS_API_BASE_URL']! as String);
        expect(c.apiBaseUrl.scheme, 'https', reason: f);
        expect(c.apiBaseUrl.host, endsWith('example.com'), reason: f);
      }
    });

    test('no real staging/production config or secrets are committed', () {
      expect(File('config/staging.json').existsSync(), isFalse);
      expect(File('config/production.json').existsSync(), isFalse);
      for (final f in Directory('config').listSync().whereType<File>().where((f) => f.path.endsWith('.json'))) {
        final text = f.readAsStringSync();
        expect(
          text,
          isNot(matches(RegExp(r'(secret|password|token|api[_-]?key)', caseSensitive: false))),
          reason: f.path,
        );
      }
    });
  });
}
