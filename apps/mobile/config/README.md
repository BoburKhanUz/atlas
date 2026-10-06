# Build-time configuration

Values are passed with `--dart-define-from-file` (or `--dart-define`). They are validated at startup by `lib/core/config/environment_config.dart`: an invalid configuration stops the app instead of running against the wrong backend. None of the values are secret; the app holds no API keys.

| Key | Values |
|---|---|
| `ATLAS_ENV` | `development`, `staging` or `production` |
| `ATLAS_API_BASE_URL` | Backend origin only (no path). `https` is required outside development; production and every release build also reject local and private hosts |

| File | Committed | Purpose |
|---|---|---|
| `development.json` | yes | Local backend. The Android emulator reaches the development machine as `10.0.2.2`; on a device use `adb reverse tcp:3000 tcp:3000` with `http://localhost:3000`; the iOS simulator uses `http://localhost:3000` |
| `staging.example.json`, `production.example.json` | yes | Shape of the pipeline-provided files (placeholder hosts) |
| `staging.json`, `production.json` | **no** (git-ignored) | Created by the release pipeline |

```bash
flutter run --dart-define-from-file=config/development.json
flutter run --dart-define-from-file=config/staging.json
flutter build apk --release --dart-define-from-file=config/production.json            # needs android/key.properties
flutter build appbundle --release --dart-define=ATLAS_ENV=production --dart-define=ATLAS_API_BASE_URL=https://api.example.com
```

## Release builds fail closed

A release build (`flutter build … --release`) refuses to start, instead of silently running against the wrong backend, when:

- `ATLAS_ENV` is `development` (whatever the URL);
- the URL is not `https`;
- the host is local or private: `localhost`, `*.localhost`, `*.local`, single-label names, `0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::`, `::1`, `fc00::/7`, `fe80::/10`, `fec0::/10` and IPv4-mapped forms of these (`::ffff:10.0.0.1`). Trailing dots are ignored (`localhost.`), and non-canonical IPv4 literals that resolvers accept (`127.1`, `0x7f.0.0.1`, `2130706433`) are refused.

Public names and public IP literals are accepted. Development **debug** builds keep using local http (`10.0.2.2`, `localhost`, LAN addresses). Staging debug builds may use a private https host for internal testing; staging release builds may not. Production rejects local and private hosts in every build mode. The host rules are in `lib/core/config/host_policy.dart`.

## Android release signing

Release builds are signed with the key in `android/key.properties` (git-ignored; never commit it or the keystore):

```properties
storeFile=/absolute/path/to/atlas-release.jks
storePassword=…
keyAlias=…
keyPassword=…
```

Without it, **every release build fails** (`assembleRelease`, `bundleRelease`, `flutter build apk|appbundle --release`). An incomplete file or a missing keystore fails too.

The only exception is a **local, non-distributable** test build signed with the debug key, which needs an explicit command-line flag:

```bash
flutter build apk --release -PallowDebugSigning=true --dart-define-from-file=config/staging.json
# or with Gradle: ./gradlew :app:assembleRelease -PallowDebugSigning=true
```

The flag is read only from the command line (`-P`): `gradle.properties`, `~/.gradle/gradle.properties` and `ORG_GRADLE_PROJECT_*` variables cannot enable it, the value must be exactly `true`, and the build prints a warning. Never distribute such a build. `tool/check_release_signing_guard.sh` (run in CI) proves these rules with Gradle dry runs.

## Logging

Logging follows the environment: development logs verbosely in debug builds, staging logs warnings only, and production and every release build log nothing.
