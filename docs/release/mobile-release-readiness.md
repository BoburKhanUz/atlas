# ATLAS mobile: release readiness

Status of the Flutter app (`apps/mobile`) after Phase 3.10. It separates what has been **verified automatically** (tests, builds, scans on Linux) from what **still needs devices, a Mac or release credentials**. Nothing here claims device or iOS verification: none has been done.

## Summary

| Level | Meaning | Status |
|---|---|---|
| **Push readiness** | The branch can be pushed and reviewed; CI should pass | **READY**. Every local check passes (see *Verification*). The new `mobile` CI job has been validated locally (actionlint, each step run on Linux) but has **not run on GitHub yet**, because nothing has been pushed. |
| **Staging readiness** | Internal testers can install a build that talks to a staging backend | **READY WITH CONDITIONS**. Needs: a staging backend over https and a pipeline-provided `config/staging.json`; an Android release key, or a local build with `-PallowDebugSigning=true` sideloaded to testers' devices only (never through a store track); and a smoke pass of the Android device test plan. iOS staging (TestFlight) needs everything in *iOS gates*. |
| **Store-release readiness** | Google Play / App Store submission | **NOT READY**. Blocked by the *Store-release gates* below: device verification, signing, Mac/iOS work, store assets and listing/privacy declarations. |

## Architecture status

| Area | Phase | Status |
|---|---|---|
| Project, design system, routing (`go_router`), state (Riverpod 3) | 3.1 | Implemented |
| Generated API client from `docs/api/openapi.json`, HTTP layer, errors, retry, connectivity | 3.2 | Implemented; drift-checked in CI |
| Secure session: Keystore/Keychain tokens, refresh and recovery per `client-recovery-vectors.json` | 3.3 | Implemented |
| Onboarding (single profile PATCH) | 3.4 | Implemented; 20-per-list limit fixed in 3.10 |
| Wardrobe, image preparation (JPEG, EXIF/GPS removal), idempotent upload, interrupted-upload recovery | 3.5 | Implemented |
| Analysis review and attribute corrections | 3.6 | Implemented |
| Weather (coarse location, manual city) and outfits | 3.7 | Implemented |
| AI stylist chat | 3.8 | Implemented |
| Profile, colour profile (consented selfie), account deletion | 3.9 | Implemented |
| Release hardening (config, signing, a11y, CI, documents) | 3.10 | Implemented |

Architecture details: [`docs/architecture/mobile-app.md`](../architecture/mobile-app.md).

## Security status

Verified in 3.10 (automated tests, the release APK and static inspection):

- **Configuration fails closed.** A release build refuses `ATLAS_ENV=development`, non-https URLs and local/private hosts (IPv4/IPv6 private, loopback, link-local, CGNAT, unspecified, IPv4-mapped, non-canonical IPv4 literals; `localhost`, `*.local`, single-label and trailing-dot names). Production refuses them in every build mode. Public hosts are accepted. Covered by config tests with mutation testing.
- **No cleartext in release.** The release network security config is `cleartextTrafficPermitted="false"` with system trust anchors only (inspected in the built APK). Debug allows cleartext only to `10.0.2.2`, `localhost` and `127.0.0.1`. The release binary embeds only the URL it was built with (no development hosts found).
- **Tokens.** Stored only in Android Keystore-backed / iOS Keychain secure storage (`first_unlock_this_device`, not synchronised). They are never placed in SharedPreferences, files, SQLite or logs. Bearer authentication only, with no cookie fallback.
- **Logging.** Off in every release build and in production; staging logs warnings only. Redaction covers tokens, signed URLs, conversation ids, coordinates, profile and chat text; tests assert on the log output.
- **Android manifest (merged, release APK).** Permissions are `INTERNET`, `ACCESS_NETWORK_STATE` and `ACCESS_COARSE_LOCATION`, plus AndroidX's signature-level `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No fine location, no storage permission. The app is not debuggable. `allowBackup="false"`, `fullBackupContent="false"` and data-extraction rules exclude app data. The only exported components are the launcher activity and AndroidX `ProfileInstallReceiver`, which is protected by `android.permission.DUMP`.
- **Release signing fails closed.** Without `android/key.properties`, release builds fail. The only exception is the explicit command-line flag `-PallowDebugSigning=true`. See *Signing requirements*.
- **Retry policy.** No automatic POST retry except uploads with their `Idempotency-Key`.
- **Scans.** gitleaks found no leaks (working tree and local commits). osv-scanner found no known vulnerabilities in the 114 locked packages (`apps/mobile/pubspec.lock`). The repository contains no keystores, `key.properties`, APK/AAB/IPA files, or real staging/production configs; CI checks this.

## Production configuration requirements

- `config/production.json` (or `--dart-define`) is created by the release pipeline. It is never committed.
  - `ATLAS_ENV=production`
  - `ATLAS_API_BASE_URL=https://<public API origin>`: origin only, public host, valid TLS certificate from a public CA. User-installed CAs are not trusted in release.
- Backend: the same API version as `docs/api/openapi.json` at the release commit. CI checks that the generated client matches it.
- Weather: a real provider in production. `WEATHER_PROVIDER=mock` is only for tests.
- No secrets ship in the app: there are no API keys.

## Signing requirements

**Android**
- An upload/release keystore is created and kept outside the repository (for example a CI secret or a password manager). `android/key.properties` points at it and is git-ignored.
- Use Play App Signing; keep the upload key and its passwords backed up.
- `-PallowDebugSigning=true` is for local test builds only. Such a build must never be uploaded or distributed: it is signed with the machine's debug key, and the build prints a warning.

**iOS** (not done; needs a Mac)
- Apple Developer team, App ID `uz.atlas.app`, distribution certificate and provisioning profile, and an App Store Connect app record.

## CI status

`.github/workflows/ci.yml` → job **`mobile`** (ubuntu-24.04; Flutter 3.47.6 and JDK 17 pinned):

1. `flutter pub get --enforce-lockfile`
2. `dart format --set-exit-if-changed`
3. `flutter analyze`
4. `flutter test` (real-backend tests skip themselves)
5. Repository hygiene: no signing material, builds or real configs tracked; release cleartext off; backup off
6. `flutter build apk --debug` with the committed development config
7. `tool/check_release_signing_guard.sh`: release builds without a key fail; only the command-line opt-in passes
8. `tool/openapi/generate_api.sh --check`: generated client equals the OpenAPI document

Secrets are covered by the existing repo-wide `secret-scan` (gitleaks) job. The web jobs are unchanged. No production secrets are used.

The job has been validated locally (actionlint 1.7.7; every step run on Linux). **It has not yet run on GitHub.** Its first run happens on the next push.

## Device verification requirements

**No device testing has been done.** Everything above was verified on Linux with widget/unit tests, a disposable local backend and APK inspection.

- Android: run every item in [`mobile-device-test-plan.md`](mobile-device-test-plan.md) on an API 29–33 device and an API 34+ device, with a release build against staging.
- iOS: run every iOS item on a physical iPhone. This needs a Mac with Xcode.
- A store release needs every item to be PASS, or FAIL with an accepted, documented exception.

## Known limitations

- **iOS has never been built.** Linux can't build iOS. The Xcode project and plists were only checked statically.
- **No offline database.** Data is kept in memory; offline means "last loaded data while the app runs".
- **The AI stylist doesn't stream.** It shows one answer per request, with a 70 s timeout.
- **Lists aren't paginated where the API isn't** (outfits, conversations).
- **No push notifications, analytics or crash reporting.** These are product decisions. With no crash reporting, release crashes are invisible until one is added.
- **The colour profile can't be deleted on its own.** Account deletion removes it.
- **Profile body fields** (gender, fit, sizes and so on) are not shown or edited, because `ProfileRow` lacks them in the contract.
- **Flutter build warning:** some plugins haven't migrated to Flutter's "Built-in Kotlin". It isn't an error today, but a future Flutter upgrade will need updated plugins.
- **Mobile follow-up:** in Profile editing, `ProfileDraft` ignores an add to a full list, but still removes the value from the opposite list. The UI prevents this: chips are disabled at the limit. Onboarding was fixed in 3.10; Profile should get the same no-op rule.

## Backend follow-ups (not done; the backend is frozen for mobile phases)

| Area | Follow-up |
|---|---|
| Profile | Expand `ProfileRow` (body fields) in OpenAPI, then regenerate the client |
| Colour profile | Delete endpoint; `Idempotency-Key` on `POST /color-profile/analyze`; contract statuses (backend returns 422 `INVALID_IMAGE` where the contract lists 415/413; HEIC is accepted); history if needed |
| Outfits | Generator-safe/named `weatherUsed` schema; `Idempotency-Key` on `POST /outfits`; `ImageObject` (id, expiry) for generated items instead of a bare `imageUrl`; pagination for `GET /outfits` |
| Weather | `GET /weather/current` should degrade instead of returning 500 when the provider fails |
| Stylist | `Idempotency-Key` on `POST /stylist/chat`; a flag on stored AI fallback answers; 404 for an unknown/foreign `conversationId` (today a new conversation starts); delete/rename and pagination for conversations; streaming |

## Store-release gates

All must be done before submission. ☐ = open.

**Both platforms**
- ☐ Device test plan completed (Android and iOS), all PASS or accepted exceptions
- ☐ The `mobile` CI job is green on GitHub for the release commit
- ☐ Production backend deployed at the contract version; production config created by the pipeline
- ☐ Real app icon and splash. The Android launcher icon is still the Flutter template default; iOS icons need checking.
- ☐ Version and build number set (`pubspec.yaml` is `0.1.0+1`)
- ☐ Privacy policy URL; account-deletion instructions (in-app deletion exists)
- ☐ Decide on crash reporting before a public release (none today)
- ☐ Backend follow-ups triaged (none block a first release technically; the missing idempotency keys are mitigated by the app never auto-retrying those POSTs)

**Android / Google Play**
- ☐ Release keystore and `android/key.properties` in the release pipeline; Play App Signing enrolled
- ☐ Release **App Bundle** built and signed (`flutter build appbundle --release`) and tested via an internal testing track
- ☐ Data safety form: account email, name, style/colour preferences, wardrobe photos (EXIF removed), approximate location (sent rounded, not stored), selfie (processed once, derived colours kept), chat messages
- ☐ Target API level meets Play's requirement at submission time (the app targets API 36 today)
- ☐ Store listing (text, screenshots, content rating)

**iOS / App Store** (needs a Mac)
- ☐ First successful `flutter build ios --release` and Xcode archive
- ☐ Signing (team, certificates, provisioning)
- ☐ `PrivacyInfo.xcprivacy` added for the app; plugin privacy manifests checked (none in `ios/Runner` today)
- ☐ `ITSAppUsesNonExemptEncryption` set (standard HTTPS only) to skip the export-compliance question
- ☐ `NSCameraUsageDescription` updated: today it mentions only the wardrobe, but the camera is also used for the colour-analysis selfie
- ☐ Decide whether `NSAllowsLocalNetworking` (for local development) stays in the release `Info.plist`, or move it to a debug-only configuration
- ☐ App Privacy answers in App Store Connect (same data as Play's form)
- ☐ TestFlight build tested on devices
