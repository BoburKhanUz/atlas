/// Runtime configuration, passed at build time with
/// `--dart-define-from-file=config/<env>.json` (see config/README.md).
/// The app holds no secrets: every credential comes from the user's session.
enum AppEnvironment {
  development,
  staging,
  production;

  static AppEnvironment parse(String value) => switch (value) {
    'development' => AppEnvironment.development,
    'staging' => AppEnvironment.staging,
    'production' => AppEnvironment.production,
    _ => throw AppConfigError('ATLAS_ENV must be development, staging or production (got "$value")'),
  };
}

class AppConfigError extends Error {
  AppConfigError(this.message);
  final String message;
  @override
  String toString() => 'AppConfigError: $message';
}

class AppConfig {
  const AppConfig({required this.environment, required this.apiBaseUrl});

  /// Validates the raw values. Outside development the API must use https.
  factory AppConfig.fromValues({required String environment, required String apiBaseUrl}) {
    final env = AppEnvironment.parse(environment.trim());
    final raw = apiBaseUrl.trim();
    if (raw.isEmpty) throw AppConfigError('ATLAS_API_BASE_URL is not set');
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty || !(uri.isScheme('http') || uri.isScheme('https'))) {
      throw AppConfigError('ATLAS_API_BASE_URL must be an absolute http(s) URL (got "$raw")');
    }
    if (uri.path.isNotEmpty && uri.path != '/' || uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) {
      throw AppConfigError('ATLAS_API_BASE_URL must be an origin only, e.g. https://api.example.com');
    }
    if (env != AppEnvironment.development && !uri.isScheme('https')) {
      throw AppConfigError('ATLAS_API_BASE_URL must use https outside development');
    }
    return AppConfig(
      environment: env,
      apiBaseUrl: Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null),
    );
  }

  /// Reads the compile-time defines.
  factory AppConfig.fromEnvironment() => AppConfig.fromValues(
    environment: const String.fromEnvironment('ATLAS_ENV', defaultValue: 'development'),
    apiBaseUrl: const String.fromEnvironment('ATLAS_API_BASE_URL'),
  );

  final AppEnvironment environment;

  /// Backend origin without a trailing slash, e.g. `https://api.atlas.uz`.
  final Uri apiBaseUrl;

  bool get isProduction => environment == AppEnvironment.production;
}
