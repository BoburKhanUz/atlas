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
    main.dart                  entry: validate AtlasEnvironmentConfig, start ProviderScope
    app/                       app root, router, tab shell
    core/
      config/                  AtlasEnvironmentConfig (environment, URL, logging, timeouts, retry)
      design/                  tokens (colours, spacing, radii, motion), typography, ThemeData
      widgets/                 shared UI: buttons, cards, skeletons, empty, error and offline states
      logging/                 redacting logger (silent in release)
      network/                 Dio + interceptors, ApiFailure + error mapper, retry, connectivity
      session/       (3.3)     token store (secure storage), refresh coordinator (recovery vectors)
    features/
      auth/          (3.3)     login, register, logout
      onboarding/    (3.4)     gate (who sees it), steps, one PATCH /profile on Finish
      home/                    today: weather and outfit entry points
      wardrobe/      (3.5–3.6) list, add (camera/gallery/upload), item detail and edit
      outfits/       (3.7)     generate, list, detail, save, feedback
      weather/       (3.7)     location permission, current weather
      stylist/       (3.8)     conversations and chat
      profile/       (3.9)     profile, preferences, colour profile, sessions, account deletion
      <feature>/data           API calls and mapping for that feature (when it has any)
      <feature>/presentation   screens, widgets, controllers (Riverpod Notifiers)
  packages/atlas_api/          client generated from docs/api/openapi.json (never edited by hand)
  tool/openapi/                generation pipeline (prepare spec → openapi-generator → build_runner)
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
- **Guard (3.3/3.4, implemented):** one pure function, `authRedirect(AuthState, OnboardingStatus, location)` in `lib/app/router.dart`, with the router listening to `SessionController` and `OnboardingGate`.
  - `AuthRestoring` → `/splash`.
  - `Unauthenticated`, `SessionExpired` and `Authenticating` → `/login` (or `/register`).
  - `Authenticated`, `Refreshing` and `LoggingOut` → the shell, once onboarding is decided:
    - `checking` → splash;
    - `required` → `/onboarding`;
    - `notRequired` → the shell, kept away from splash, auth screens and onboarding.
  - A refresh never navigates. Only a session that ended leads to sign-in, so there is no Login → refresh → Login loop. Tests check that every redirect target is stable.
- **Tab shell behaviour (3.4):**
  - Re-tapping the active tab returns it to its root, and its `AtlasPage` scrolls to the top (`TabReselect`; it jumps when reduced motion is on).
  - Android back pops inside a tab first. On another tab's root it goes to Home; on Home the app exits.
- **Full-screen routes (from 3.5):** `atlasFullScreenRoute(path:, builder:)` defines a top-level route.
  - It lives on the root navigator and covers the bottom bar.
  - It is opened with `context.push(path)`; back returns to the tab exactly as it was.
  - The auth redirect applies to it like any other route.

## Onboarding (3.4, implemented)

- **Who sees it (`OnboardingGate`):** decided once per signed-in user.
  - A local `completed`/`skipped` marker for this user means no.
  - Otherwise, `GET /api/v1/profile` with no style or colour preferences means yes.
  - Any failure or a 6 s timeout means no, so the user is never blocked.
  - A token refresh never re-decides; only a different user or the end of the session does.
- **Steps:** welcome → style (liked/disliked) → profile (`gender`, `preferredFit`) → colours (favourite/disliked) → finish.
  - Every step after the welcome has "Skip step", which drops that step's answers, and "Skip all", which leaves without sending anything.
  - System back goes to the previous step.
- **Answers:** in memory only (an auto-disposed Riverpod Notifier). They are never stored, never logged, and gone after Finish.
- **Finish:** sends one `PATCH /api/v1/profile` with exactly the chosen fields, in contract wire values.
  - Empty lists and unset fields are omitted, and nothing is sent when nothing was chosen.
  - On failure the answers are kept and the button becomes "Retry". `SESSION_BUSY` alone is repeated by the transport retry policy, since it has no side effects.
  - A session that ends during the save goes to sign-in through the auth state.
- **Marker:** `atlas.onboarding.v1.<userId>` in secure storage holds `completed` or `skipped`.
  - It is a client-side UX marker, not the server's onboarding state, and holds no answers.
  - It survives logout, so it is per user and per device.
- **Deferred:** selfie colour analysis (3.9), location permission (3.7, when weather is first used), first wardrobe item (3.5, offered as a link on the finish step), language (Uzbek only for now).
- **Contract follow-up before 3.9:** `ProfileRow` is documented as `{id, userId}` only, so the generated client cannot read back `gender` or `preferredFit`.
- **Full-screen flows** above the shell: add item, item detail, outfit detail, chat thread.
- **Deep links:** none in v1. Paths are stable, so they can be added later.

## API client integration (3.2, implemented)

### Generated client

- **Package:** `packages/atlas_api` is generated from `docs/api/openapi.json` by `tool/openapi/generate_api.sh`, with the generator CI already uses: openapi-generator **v7.10.0**, `dart-dio`, `built_value`.
- **Config:** `tool/openapi/generator-config.yaml`. `enumUnknownDefaultCase: true` means a new backend enum value (for example a new error code) decodes as `unknown_default_open_api` instead of failing the whole response.
- **Committed and checked:** generated code, including the built_value `.g.dart` files, is committed so builds need neither Docker nor build_runner. `generate_api.sh --check` regenerates into a temporary directory and fails if the committed copy differs. Generation is deterministic: two independent runs produce an identical tree.
- **Never edited by hand.** The app analyzes it separately: 0 errors, plus generator warnings about unused imports.
- **Spec preparation** (`tool/openapi/prepare_spec.dart`, generation only). The contract file itself is never changed. It works around two limitations of the pinned generator with OpenAPI 3.1:
  1. **Binary content.** The contract marks binary payloads OpenAPI 3.1 style (`type: string, contentMediaType: …`), which the generator types as `String`. The step adds the equivalent 3.0 spelling, `format: binary`, to the 5 binary schemas: the multipart `file` of `POST /wardrobe/items` and `POST /color-profile/analyze`, and the three image responses of `GET /media/{key}`. The upload therefore takes a real `MultipartFile`.
  2. **Non-string `const`** (`Detection.mock`, `OkResponse.ok`, both `const: true`). The generator turns these into a *string* enum, so the real JSON `true` decoded as "unknown". The step relaxes them to `{type: boolean}` for generation only; the server still enforces the value. String `const`s are kept.

  Both are covered by `test/tool/prepare_spec_test.dart`: exact pointers, nothing else changed, idempotent.

### HTTP layer (`lib/core/network/`)

- **One shared `Dio`** (`buildAtlasDio`), built from `AtlasEnvironmentConfig`:
  - base URL and timeouts: connect 10 s, receive 20 s, send 60 s, plus 12 s per refresh call in 3.3
  - `followRedirects: false`, so an `Authorization` header is never forwarded to another host
  - no cookie jar
- **Interceptors, in order:**
  1. `AtlasClientHeadersInterceptor`:
     - `X-Atlas-Client: mobile` on every request; callers cannot override it.
     - `Accept: application/json`.
     - Strips any `Cookie` header.
     - Rejects credential-like query parameters as a programming error.
  2. `AtlasBearerInterceptor`:
     - Adds `Authorization: Bearer <access>` only to operations whose contract `security` includes `bearerAuth`.
     - Removes `Authorization` everywhere else: login, register, refresh, health and signed media.
     - Reads the token per request from `AccessTokenSource` (Phase 3.3 provides it).
     - There is no cookie fallback. The generated client's own auth interceptors are never installed (`AtlasApi(interceptors: [])`); its `ApiKeyAuthInterceptor` would send the token as an `atlas_at` cookie.
  3. `AtlasLoggingInterceptor`: logs method, path (never the query, which can hold a media signature), status, duration and error code. Never headers or bodies.
  4. `AtlasReachabilityInterceptor`: any HTTP response means the API is reachable; a connection error or timeout means it is not.
  5. `AtlasRetryInterceptor` (see *Retry*).
- **`AtlasApiClient.call(...)`** wraps every generated operation. It returns the data or throws exactly one `ApiFailure`. Phase 3.3 adds the 401 recovery coordinator in front of it.

### Errors (`ApiFailure`, `ApiErrorMapper`)

**Failure types:**

| Failure | Meaning |
|---|---|
| `NoNetworkFailure` | The device has no network |
| `ApiUnreachableFailure` | The device is online but the API can't be reached |
| `TimeoutFailure` | A request timed out |
| `InsecureConnectionFailure` | TLS failed; never retried or bypassed |
| `CancelledFailure` | The request was cancelled |
| `UnexpectedResponseFailure` | Non-contract response: HTML from a proxy, or a body that fails the schema |
| `ApiHttpFailure` | A documented error response (details below) |

**`ApiHttpFailure` fields:**
- `statusCode`
- `code`: the `ApiErrorCode` enum of all 22 contract codes, plus `unknown`, which keeps `rawCode`
- `serverMessage` and `requestId`
- `retryAfter`, parsed from `Retry-After` as delta-seconds or an HTTP date
- `fieldErrors`, from `VALIDATION_ERROR` `details`

**Kinds and retryability:**
- **Terminal session codes** (not retryable): `INVALID_TOKEN`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_REUSED`, `CLIENT_MISMATCH`.
- **Retryable:** `SESSION_RACE`, `SESSION_BUSY`, `IDEMPOTENCY_IN_PROGRESS`, `RATE_LIMITED`, `INTERNAL`.
- **Not retryable:** image errors, `IDEMPOTENCY_KEY_MISMATCH`, validation, conflict, forbidden and not found.

**User messages:** every failure has an Uzbek `userMessage`. The backend message is shown only for validation and conflict errors, and only when it doesn't look technical. Raw exceptions are never shown.

**Programming errors** (an `Error` such as a rejected query parameter) are rethrown as themselves, never disguised as network failures.

### Retry

| Situation | Automatic retry |
|---|---|
| Timeout or connection error on GET/HEAD/OPTIONS (or a JSON request explicitly marked idempotent) | After 1 s, then 2 s, only within 45 s of the first attempt |
| `503 SESSION_BUSY` | After `Retry-After` plus up to 250 ms jitter, at most 2 retries. The contract guarantees no side effects, so this applies to any method whose body can be replayed. A `Retry-After` over 30 s is not waited for |
| Any other HTTP error, certificate errors | Never |
| POST/PATCH/DELETE, account changes | Never automatically |
| Multipart uploads | Never automatically. The caller retries with the **same** `Idempotency-Key` (3.5) |

### Connectivity

Three distinct situations:
1. **No device network:** detected by `connectivity_plus` through `PlatformDeviceNetwork`.
2. **Network up but API unreachable:** learned from failing requests. "Wi-Fi connected" is never taken as proof the API is reachable.
3. **API answered with an HTTP error.**

`networkStatusProvider` combines them, and the shell shows a thin offline banner for 1 and 2.

### Signed media URLs

`SignedMediaUrl.isUsable(urlExpiresAt)` treats a URL as expired 60 s early. Signed URLs are never persisted or logged; reload the item to get a fresh one.

## Secure token storage (3.3)

- **Storage:** `flutter_secure_storage`. On Android, values are encrypted with keys held in the Android Keystore; on iOS they go to the Keychain with `first_unlock_this_device`, not synced to iCloud. The exact plugin options are fixed and verified in 3.3.
- **Stored:** one entry, `atlas.session.v1`, holding JSON with:
  - the access token, refresh token, their expiry times and `sessionExpiresAt`;
  - the `SessionUser` (id, email, name) for offline start;
  - the server clock offset, measured from the response `Date` header so expiry checks survive a wrong device clock.
  The pair is written as one value and read back before it counts, so a crash can never leave mismatched halves.
- **Options (verified by tests):** Android uses namespace `atlas_session`, with AES-GCM data encryption under an RSA-OAEP key held in the Keystore. iOS uses `first_unlock_this_device` with `synchronizable: false`.
- **Failure handling:**
  - A storage failure during login or registration means the user is not authenticated, and the new server session is logged out.
  - During refresh, the old pair stays active (no mixed pair). The request fails with `SecureStorageFailure`, and the next refresh within 60 s gets the same new pair again as a grace replay.
  - An unreadable store at startup is not deleted.
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
| `SESSION_RACE` (V02/V03) | Re-read secure storage. If it holds a newer pair (another writer saved it), use it: re-send the original request once, without a refresh (V02). Only if that still gets 401, refresh once with the newest token (V03). If storage holds the same token, wait 1 s and refresh once more with it, since a grace replay may succeed. A second race (V04) deletes the local tokens without any server call and shows login; that token is never presented again |
| `SESSION_BUSY` 503 (V06/V07) | Wait `Retry-After` plus jitter and retry. After 3 attempts, show a "server busy" banner, keep the tokens and allow no automatic refresh for 30 s |
| Network error or timeout (V08/V09) | Retry after 1 s, then 2 s, but only within 45 s of the first attempt (monotonic clock). Then show offline mode, keep the tokens and allow a 30 s cool-down |
| Terminal codes `INVALID_TOKEN`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_REUSED`, `CLIENT_MISMATCH` (V05) | Delete the local tokens and go to login with an explanation. No retries, and **never** call logout because a refresh failed |

- **Proactive refresh:** when `accessTokenExpiresAt` is under 30 s away (judged on the server clock offset), the app refreshes before sending the request. It follows the same single-flight rules: 5 concurrent requests cause one refresh.
- **Stale 401:** each request remembers the token generation it was sent with. A 401 for an older pair than the active one is re-sent without another refresh.
- **Re-sent requests:** a request re-sent after recovery that still gets 401 is returned as is, with no loop and no logout.
- **Implementation:**
  - `lib/core/session/recovery.dart` holds the pure episode logic and the rules.
  - `session_controller.dart` holds the coordinator, storage and state.
  - `session_interceptor.dart` holds the Dio interceptor.
  - Login, register, refresh and logout use a separate Dio with no Bearer, no automatic retries and no session interceptor.
- **Logout:**
  - `POST /auth/logout` with `{ refreshToken }` (no Bearer needed; the token identifies the family).
  - The in-memory pair is dropped first, and authenticated requests still running are cancelled with `SessionEndedFailure`.
  - The server call is skipped when the device is offline. It is bounded by 12 s, with one `SESSION_BUSY` retry after `Retry-After` ≤ 2 s.
  - Secure storage is cleared whatever the response (logout is idempotent server-side).
- **Startup:**
  - No stored pair → sign-in.
  - Locally past `sessionExpiresAt` → cleared.
  - Valid access token → shell, with no network call.
  - Expired access token while offline → shell with the session kept.
  - Expired access token while online → one controlled refresh. The splash waits at most 8 s; a later result still applies.

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

## Environment configuration (3.2, implemented)

`AtlasEnvironmentConfig`, in `lib/core/config/environment_config.dart`, is validated at startup and fails fast. Values come from `--dart-define-from-file=config/<env>.json` or from `--dart-define`.

| | development | staging | production |
|---|---|---|---|
| `ATLAS_API_BASE_URL` | http or https (local backend allowed) | **https required** | **https required**; local/private hosts rejected |
| debug features | yes (debug builds only) | no | no |
| log policy | verbose (`off` in release builds) | warnings | **off** |
| timeouts and retry policy | defaults (see *Retry*) | same | same |

- **Base URL:** must be an origin only, with no path, query, fragment or credentials.
- **Committed configs:** only `config/development.json` and placeholder `*.example.json` files. Real `staging.json` and `production.json` are git-ignored and created by the release pipeline.
- **No secrets:** none are in the app or the config files.

**Commands:**
```bash
flutter run --dart-define-from-file=config/development.json
flutter run --dart-define-from-file=config/staging.json            # created by the pipeline
flutter build apk --release --dart-define-from-file=config/production.json
# or explicitly:
flutter build apk --release --dart-define=ATLAS_ENV=production --dart-define=ATLAS_API_BASE_URL=https://api.example.com
```

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
