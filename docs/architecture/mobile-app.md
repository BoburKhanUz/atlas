# ATLAS mobile app (Flutter): architecture

The native app in `apps/mobile` is the primary ATLAS product UI for Android and iOS. The Next.js app (`apps/web`) stays the backend and the web reference client.

The app consumes the backend only through the published contract:
- `docs/api/openapi.json`: OpenAPI 3.1 for the 29 operations, request and response schemas, and error codes per status (`x-error-codes`).
- `docs/architecture/sessions.md`: the session model, mobile mode and error codes.
- `docs/api/client-recovery-vectors.json`: session recovery rules (vectors V01–V09, each with its `mobile` instruction).
- `docs/architecture/media.md`: upload rules, variants and signed URLs.

The app never invents an endpoint, field or session rule. A contract gap is reported and fixed in the backend first.

Toolchain: Flutter 3.47 (stable), Dart 3.13. Material comes from the standalone `material_ui` package, which is the package `go_router` 18 builds its pages with. The app never imports `package:flutter/material.dart`; mixing the two would create two separate `Theme` types.

## Folder structure

Code is organised by feature, with a thin shared core. There are no use-case classes, repository interfaces that have only one implementation, or dependency-injection containers. Riverpod providers do the wiring.

```
apps/mobile/
  lib/
    main.dart                  entry: read AppConfig, start ProviderScope
    app/                       app root, router, tab shell
    core/
      config/                  AppConfig from --dart-define (environment, API base URL)
      design/                  tokens (colours, spacing, radii, motion), typography, ThemeData
      widgets/                 shared UI: buttons, cards, skeletons, empty, error and offline states
      logging/                 redacting logger (silent in release)
      network/       (3.2)     Dio instance, auth interceptor, error mapping, connectivity
      session/       (3.3)     token store (secure storage), refresh coordinator (recovery vectors)
    features/
      auth/          (3.3)     login, register, logout
      onboarding/    (3.4)
      home/                    today: weather and outfit entry points
      wardrobe/      (3.5–3.6) list, add (camera/gallery/upload), item detail and edit
      outfits/       (3.7)     generate, list, detail, save, feedback
      weather/       (3.7)     location permission, current weather
      stylist/       (3.8)     conversations and chat
      profile/       (3.9)     profile, preferences, colour profile, sessions, account deletion
      <feature>/data           API calls and mapping for that feature (when it has any)
      <feature>/presentation   screens, widgets, controllers (Riverpod Notifiers)
  packages/atlas_api/  (3.2)   client generated from docs/api/openapi.json (never edited by hand)
  config/                      --dart-define files per environment (no secrets)
  test/                        unit and widget tests, mirroring lib/
  integration_test/  (3.10)    on-device tests against a real backend
```

The folders marked with a phase are created in that phase, not as empty placeholders.

## State management: Riverpod 3 (`flutter_riverpod`)

- **Why Riverpod:**
  - Compile-safe dependency wiring (the API client, token store and config are providers), with test overrides through `ProviderScope(overrides: …)`.
  - Async state (`AsyncValue`) maps directly onto loading, data and error UI.
  - No `BuildContext` is needed in non-UI code such as the refresh coordinator.
  - It is widely used and maintained.
- **Rules:**
  - Plain providers and `Notifier`/`AsyncNotifier` classes; no code generation.
  - Screen state lives in the feature. Global state is limited to config, session and connectivity.

## Routing: `go_router` 18

- **Tab shell:** `StatefulShellRoute.indexedStack` with five branches: Home, Wardrobe, Outfits, Stylist, Profile. Each tab keeps its own navigation stack and scroll position, and re-tapping the active tab returns to its root.
- **Guard (3.3):**
  - Unauthenticated → `/login`.
  - Authenticated but onboarding not finished → `/onboarding`.
  - Authenticated users are kept away from auth screens.
  - The router listens to the session state, so a terminal session error moves the user to login from anywhere.
- **Full-screen flows** above the shell: add item, item detail, outfit detail, chat thread.
- **Deep links:** none in v1. Paths are stable, so they can be added later.

## API client integration (3.2)

- **Generation:** `packages/atlas_api` is generated from `docs/api/openapi.json` with the generator CI already uses (openapi-generator v7.10.0, `dart-dio`). A script, `tool/generate_api.sh`, does it. Generated code is committed so builds don't need Docker. CI regenerates the client and fails if it differs from the committed copy, and requires 0 analyzer errors.
- **Known generator issue:** the multipart `file` field of `createWardrobeItem` comes out as `String`, not as binary. This is fixed through generator configuration (type mapping) and regeneration, never by editing generated files.
- **One shared `Dio`** with:
  - the base URL from `AppConfig`
  - `X-Atlas-Client: mobile` on **every** request
  - `Authorization: Bearer <access>` on authenticated operations
  - timeouts: connect 10 s, receive 20 s, refresh call 12 s (the contract value)
  - interceptors, in this order: auth header → 401 recovery (session coordinator) → error mapping
- **Feature data code** calls the generated API classes and maps their models into small view models only where the screen needs a different shape.

## Secure token storage (3.3)

- **Storage:** `flutter_secure_storage`. On Android, values are encrypted with keys held in the Android Keystore; on iOS they go to the Keychain with `first_unlock_this_device`, not synced to iCloud. The exact plugin options are fixed and verified in 3.3.
- **Stored:** the access token, refresh token, their expiry times, `sessionExpiresAt` and the user id. The pair is written in one value (JSON), so a crash can never leave mismatched halves.
- **Never stored or logged:** tokens in SharedPreferences, files, SQLite, Hive, logs, analytics or crash reports. Signed media URLs are never persisted; they expire (`urlExpiresAt`) and are refetched.
- **Android backup:**
  - `allowBackup="false"`, plus `dataExtractionRules` that exclude everything from cloud backup and device transfer. A restored Keystore-encrypted value would be unreadable anyway.
  - Tokens are bound to the device and client type: a mobile family rejects web use with `CLIENT_MISMATCH`.

## Refresh and recovery (3.3), exactly as `client-recovery-vectors.json`

- **Episode start:** a request returning 401 starts a recovery episode. There is one episode per app process at a time, and concurrent 401s wait on the same episode (single-flight).
- **Limits:** at most 3 refresh calls per episode, each with a 12 s timeout.
- **Recovery rules:**

| Refresh response | What the app does |
|---|---|
| 200 (V01) | Save the new pair to secure storage **first**, then replace the in-memory pair; retry the original request once |
| `SESSION_RACE` (V02/V03) | Re-read secure storage. If it holds a newer token, refresh with that. Otherwise wait 1 s and retry the refresh once, since a grace replay may succeed. A second race (V04) deletes the local tokens without any server call and shows login; that token is never presented again |
| `SESSION_BUSY` 503 (V06/V07) | Wait `Retry-After` plus jitter and retry. After 3 attempts, show a "server busy" banner, keep the tokens and allow no automatic refresh for 30 s |
| Network error or timeout (V08/V09) | Retry after 1 s, then 2 s, but only within 45 s of the first attempt (monotonic clock). Then show offline mode, keep the tokens and allow a 30 s cool-down |
| Terminal codes `INVALID_TOKEN`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_REUSED`, `CLIENT_MISMATCH` (V05) | Delete the local tokens and go to login with an explanation. No retries, and **never** call logout because a refresh failed |

- **Proactive refresh:** when `accessTokenExpiresAt` is under 60 s away, the app refreshes before sending the request. It still follows the same single-flight rules.
- **Logout:** `POST /auth/logout` with `{ refreshToken }` and Bearer. Local tokens are cleared whatever the response (logout is idempotent server-side). `SESSION_BUSY` on logout is retried once in the background.

## Upload architecture (3.5–3.6)

- **Sources:** camera and gallery (system photo picker). Images are prepared on-device before upload:
  - HEIC/HEIF/AVIF is converted to JPEG, since the backend returns 415 for those.
  - Images are downscaled so the longest side is at most 4096 px.
  - JPEG quality is around 0.9.
  - Images whose shortest side is under 256 px are rejected locally (backend `IMAGE_DIMENSIONS`).
  - The app ensures the file is ≤ 8 MB (backend 413).
- **Idempotency:** each upload gets an `Idempotency-Key` (UUID v4, matching `^[A-Za-z0-9_-]{8,128}$`), created once per user action and kept with the pending upload. Retries reuse the key:
  - The same key with the same bytes replays the stored result (`Idempotent-Replayed: true`), so there are never duplicate items.
  - `IDEMPOTENCY_IN_PROGRESS` (409 with `Retry-After`) means the app waits and retries.
  - `IDEMPOTENCY_KEY_MISMATCH` means the app's own bug (different bytes under the same key); it starts a new upload with a new key.
- **Analysis:** it happens inside the upload request; the 201 response already contains the detected item. There is no server-side analysis job.
  - UI states: preparing → uploading (byte progress) → analysing (request sent, waiting for the response) → done or needs correction (low confidences) → failed (retry available).
  - Pending uploads (prepared file path plus idempotency key) are kept in the app's private storage, so a restart or network loss resumes with the same key instead of getting stuck.
  - The item list from the server is the source of truth.

## Offline behaviour

- **Connectivity:** detected with `connectivity_plus` together with request failures; a request failure is authoritative. A banner shows offline state and tabs keep showing the last loaded data in memory.
- **Retries:** safe requests (GET) retry automatically with backoff after reconnecting. Non-idempotent requests are **never** retried automatically; the only exception is uploads with their `Idempotency-Key`.
- **Preserved input:** typed chat messages, the add-item draft and pending uploads.
- **No offline database:** the product does not need one in v1.

## Error handling

There is one error type, `AppFailure`, created from:
- the backend `ErrorResponse` (`code`, `error`, `requestId`)
- Dio/network errors, timeouts and unexpected responses

Every backend code from `ErrorResponse.code` maps to a typed kind and an Uzbek user message, for example `UNSUPPORTED_IMAGE_FORMAT` → "Bu rasm formati qo'llab-quvvatlanmaydi — JPEG, PNG yoki WebP tanlang".
- **Session codes** go to the recovery coordinator, not to screens.
- **Validation errors** (`details[].path`) map onto form fields.
- **Raw exception text is never shown.** `requestId` is shown in the error details for support.

## Environment configuration

- **How values are passed:** `--dart-define-from-file=config/<env>.json`. `AppConfig.fromEnvironment()` validates the values at startup.
- **`ATLAS_ENV`:** `development`, `staging` or `production`.
- **`ATLAS_API_BASE_URL`:** the backend origin, without a trailing slash. `https` is required outside development.
- **Committed files:** only `config/development.json`, which points at the local backend (`http://10.0.2.2:3000` for the Android emulator). Staging and production files hold no secrets but are created by the release pipeline; `config/production.example.json` documents the shape.
- **No secrets in the app:** the app has none (no API keys); every credential comes from the user's session.

## Android and iOS configuration

- **IDs:** application ID and bundle identifier `uz.atlas.app`; display name "ATLAS".
- **Android:**
  - minSdk 24, target and compile SDK 36. `INTERNET` permission in the main manifest.
  - Network security: release builds forbid cleartext. The debug variant allows cleartext only to `10.0.2.2`, `localhost` and `127.0.0.1` for the local backend.
  - `allowBackup="false"` and backup exclusion rules.
  - Release signing (3.10) comes from `android/key.properties`, which is not committed. R8 shrinking is enabled for release.
- **iOS:**
  - The App Transport Security default applies, with only `NSAllowsLocalNetworking` for local development.
  - Usage descriptions for camera, photo library and location are added in the phases that use them.
  - Keychain accessibility: `first_unlock_this_device`.
  - Building needs macOS and Xcode. In environments without them, iOS is verified statically (project and plist validity, `flutter analyze`).
- **Logging:** the redacting logger is disabled in release (`kReleaseMode`); `debugPrint` is never used for API data.

## Design system

- **Tokens** (`core/design/tokens.dart`):

| Token | Value |
|---|---|
| background | `#F8F8F6` |
| surface | `#FFFFFF` |
| text primary | `#111111` |
| text secondary | `#6B7280` |
| accent | `#0F766E` |
| success | `#22C55E` |

  Plus derived hairline, soft-accent, warning and error tones; a 4-pt spacing scale; restrained radii (8/12/16/24); and motion durations (150/250/400 ms).
- **Contrast is tested in code:**

| Combination | Contrast | Rule |
|---|---|---|
| primary text on background | ≥ 7:1 | |
| secondary text on surface and background | ≥ 4.5:1 | |
| white on accent | ≥ 4.5:1 | |
| text on success green | low (≈ 2:1) | never used; success is used only for icons and indicators |

- **Typography:** the platform system font (SF Pro / Roboto) with a tight, strong scale (display 32/700 down to caption 12/500).
- **Shared widgets:** primary, secondary and ghost buttons with a loading state; cards with a hairline border; skeleton loaders that respect reduced motion; and empty, error and offline states.
- **Navigation:** a Material 3 `NavigationBar` sized for one-handed use.
