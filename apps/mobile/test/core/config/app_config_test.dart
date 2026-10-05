import 'package:atlas_mobile/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  AppConfig make(String env, String url) => AppConfig.fromValues(environment: env, apiBaseUrl: url);

  test('development accepts the local http backend', () {
    final c = make('development', 'http://10.0.2.2:3000');
    expect(c.environment, AppEnvironment.development);
    expect(c.apiBaseUrl.toString(), 'http://10.0.2.2:3000');
    expect(c.isProduction, isFalse);
  });

  test('a trailing slash is normalised away', () {
    expect(make('production', 'https://api.example.com/').apiBaseUrl.toString(), 'https://api.example.com');
  });

  test('staging and production require https', () {
    expect(() => make('staging', 'http://api.example.com'), throwsA(isA<AppConfigError>()));
    expect(() => make('production', 'http://api.example.com'), throwsA(isA<AppConfigError>()));
    expect(make('production', 'https://api.example.com').isProduction, isTrue);
  });

  test('rejects missing, relative, non-http, path, query and credential URLs', () {
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
      expect(() => make('development', bad), throwsA(isA<AppConfigError>()), reason: bad);
    }
  });

  test('unknown environment is rejected', () {
    expect(() => make('prod', 'https://x.example'), throwsA(isA<AppConfigError>()));
  });

  test('fromEnvironment without defines fails loudly (no silent default backend)', () {
    expect(AppConfig.fromEnvironment, throwsA(isA<AppConfigError>()));
  });
}
