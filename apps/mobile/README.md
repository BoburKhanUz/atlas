# ATLAS mobile (Flutter)

The native ATLAS app for Android and iOS: the primary product UI. The backend is `apps/web`, and the API contract is `docs/api/openapi.json`.

Architecture and decisions: [`docs/architecture/mobile-app.md`](../../docs/architecture/mobile-app.md).

## Requirements

- Flutter 3.47 (stable) and Dart 3.13
- Android: Android SDK 36, NDK 28.2 and JDK 17 or newer
- iOS: macOS with Xcode. iOS can't be built on Linux.

## Run

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define-from-file=config/development.json
```

The backend must be running (see the root `README.md`). Configuration is described in `config/README.md`.

## API client

```bash
tool/openapi/generate_api.sh          # regenerate packages/atlas_api from docs/api/openapi.json (Docker)
tool/openapi/generate_api.sh --check  # fail if the committed client is out of date
```

## Checks

```bash
flutter analyze
flutter test
flutter build apk --debug --dart-define-from-file=config/development.json
```

Session integration tests against a **local, disposable** backend (skipped otherwise; see the header of `test/integration/backend_session_test.dart`):

```bash
ATLAS_IT_BASE_URL=http://127.0.0.1:3100 flutter test test/integration/backend_session_test.dart
```

## Layout

| Path | Contents |
|---|---|
| `lib/app/` | App root, router (`go_router`), tab shell |
| `lib/core/design/` | Design tokens, typography, theme |
| `lib/core/widgets/` | Shared UI: buttons, cards, skeletons, empty, error and offline states |
| `lib/core/config/` | `AtlasEnvironmentConfig` (environment, URL, logging, timeouts, retry) |
| `lib/core/network/` | HTTP layer around the generated client: headers, Bearer, retry, errors, connectivity |
| `lib/core/session/` | Secure token storage, auth state, login/register/logout, refresh and recovery (client-recovery-vectors.json) |
| `lib/features/auth/` | Splash, sign-in and registration screens |
| `packages/atlas_api/` | Generated API client. **Never edit**; regenerate with `tool/openapi/generate_api.sh` |
| `lib/core/logging/` | Redacting logger, silent in release builds |
| `lib/features/<feature>/` | One folder per product area |
| `test/` | Unit and widget tests, mirroring `lib/` |

Material comes from the `material_ui` package. Import `package:material_ui/material_ui.dart`, never `package:flutter/material.dart`.
