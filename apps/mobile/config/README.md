# Build-time configuration

Values are passed with `--dart-define-from-file`. They are validated at startup by `lib/core/config/app_config.dart`. None of them are secret; the app holds no API keys.

| Key | Values |
|---|---|
| `ATLAS_ENV` | `development`, `staging` or `production` |
| `ATLAS_API_BASE_URL` | Backend origin only (no path). `https` is required outside development |

- `development.json` is committed. It points at a backend running on the development machine: the Android emulator reaches it as `10.0.2.2`.
  - On a physical Android device, run `adb reverse tcp:3000 tcp:3000` and use `http://localhost:3000`.
  - On the iOS simulator, use `http://localhost:3000`.
- `staging.json` and `production.json` are created by the release pipeline and are not committed. `production.example.json` shows their shape.
