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

Session integration tests against a **local, disposable** backend (skipped otherwise; see the header of `test/integration/backend_session_test.dart`; they cover sessions, onboarding, the wardrobe, attribute corrections, interrupted-upload recovery, weather, outfits and the AI stylist; run the backend with `WEATHER_PROVIDER=mock`):

```bash
ATLAS_IT_BASE_URL=http://127.0.0.1:3100 flutter test test/integration/
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
| `lib/features/onboarding/` | Onboarding gate, steps and the single profile save |
| `lib/features/wardrobe/` | Wardrobe list, item detail, add flow, image preparation (JPEG, EXIF/GPS removal), idempotent upload, analysis review (confidence levels), attribute editor (PATCH), interrupted-upload recovery |
| `lib/features/weather/` | Location (one coarse read, rounded to ~1 km), manual city, current weather with an in-memory 30-minute cache |
| `lib/features/outfits/` | Outfit suggestions (backend-made), save/feedback, saved and recent lists, detail (rename, unsave, delete) |
| `lib/features/stylist/` | AI stylist: conversation list and chat (one POST per send, draft kept until confirmed, unknown-outcome handling) |
| `lib/features/home/` | Today: the weather card and the entry to outfit suggestions |
| `test/fixtures/images/` | Image fixtures for the preparation tests (see its README) |
| `packages/atlas_api/` | Generated API client. **Never edit**; regenerate with `tool/openapi/generate_api.sh` |
| `lib/core/logging/` | Redacting logger, silent in release builds |
| `lib/features/<feature>/` | One folder per product area |
| `test/` | Unit and widget tests, mirroring `lib/` |

Material comes from the `material_ui` package. Import `package:material_ui/material_ui.dart`, never `package:flutter/material.dart`.
