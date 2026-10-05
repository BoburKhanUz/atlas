# Build-time configuration

Values are passed with `--dart-define-from-file` (or `--dart-define`). They are validated at startup by `lib/core/config/environment_config.dart`: an invalid configuration stops the app instead of running against the wrong backend. None of the values are secret; the app holds no API keys.

| Key | Values |
|---|---|
| `ATLAS_ENV` | `development`, `staging` or `production` |
| `ATLAS_API_BASE_URL` | Backend origin only (no path). `https` is required outside development; production also rejects local and private hosts |

| File | Committed | Purpose |
|---|---|---|
| `development.json` | yes | Local backend. The Android emulator reaches the development machine as `10.0.2.2`; on a device use `adb reverse tcp:3000 tcp:3000` with `http://localhost:3000`; the iOS simulator uses `http://localhost:3000` |
| `staging.example.json`, `production.example.json` | yes | Shape of the pipeline-provided files (placeholder hosts) |
| `staging.json`, `production.json` | **no** (git-ignored) | Created by the release pipeline |

```bash
flutter run --dart-define-from-file=config/development.json
flutter run --dart-define-from-file=config/staging.json
flutter build apk --release --dart-define-from-file=config/production.json
flutter build apk --release --dart-define=ATLAS_ENV=production --dart-define=ATLAS_API_BASE_URL=https://api.example.com
```

Logging follows the environment: development logs verbosely in debug builds, staging logs warnings only, and production and every release build log nothing.
