# ATLAS mobile: device test plan

Manual checks that automated tests can't do: they need real hardware, the real OS, platform pickers, the Keystore/Keychain, or signing. Fill in one copy per release candidate. **Every item starts as NOT TESTED.** Mark an item PASS only after you've run it on the device listed in the header; if it fails, mark it FAIL and link the issue.

Result values: `PASS` · `FAIL` · `NOT TESTED`

## Run header

| Field | Value |
|---|---|
| Release candidate (commit SHA) | |
| Build (flavour, mode, config) | e.g. `release`, `config/staging.json` |
| Signing | release key / `-PallowDebugSigning=true` (local only) |
| Backend (URL, version) | |
| Tester, date | |
| Android devices (model, API level) | API 29+ device: · API 34+ device: |
| iOS devices (model, iOS version) | |

## Preparation

- Use a **staging** backend over https. Use a development (debug) build only for the debug-only items.
- Use a fresh test account per run. **Do not** use personal photos that contain other people or location metadata you don't want shared with the team.
- Test photos to copy to the device's gallery:
  - `apps/mobile/test/fixtures/images/` has a HEIC sample, a rotated reference and plain JPEG/PNG files.
  - Make the rest from a photo with readable text (the automated tests generate them in memory): eight copies with EXIF `Orientation` 1–8 (for example `exiftool -Orientation=6 -n img6.jpg`), one ~8000 px photo, and one with GPS tags (`exiftool -GPSLatitude=41.3 -GPSLatitudeRef=N -GPSLongitude=69.2 -GPSLongitudeRef=E gps.jpg`).
- To read logs, use `adb logcat` (Android) or Console.app (iOS). A **release** build must print nothing from the app.

## Android

Run on **two devices or emulators**: API 29–33 (for example API 29 or 30) and API 34+. Items that need both say so.

| ID | Area | Check (steps → expected) | API 29+ | API 34+ | Notes |
|---|---|---|---|---|---|
| A01 | Install | Install the release APK (`flutter build apk --release` with a staging config) → it installs, launches, shows the sign-in screen | NOT TESTED | NOT TESTED | |
| A02 | Release APK | Release build with `config/development.json` → refuses to start (fail-closed config error), never talks to a local backend | NOT TESTED | NOT TESTED | |
| A03 | Cleartext | Release build pointed at an `http://` staging URL is refused at startup; with a debug build, `http://` to a non-local host is blocked by the network security config | NOT TESTED | NOT TESTED | |
| A04 | Camera | Wardrobe → Add → Camera → permission prompt appears only now → take a photo → preview → upload succeeds | NOT TESTED | NOT TESTED | |
| A05 | Camera denied | Deny camera → clear message; gallery still works; nothing crashes | NOT TESTED | NOT TESTED | |
| A06 | Gallery | Add → Gallery → pick a JPEG → upload succeeds | NOT TESTED | NOT TESTED | |
| A07 | Photo Picker | On API 33+ the system Photo Picker opens (no storage permission prompt); on API 29–32 the document picker/gallery opens | NOT TESTED | NOT TESTED | |
| A08 | HEIC | Pick a HEIC photo → converted to JPEG, uploads, shows correctly (or a clear "format not supported" message if the device can't decode HEIC) | NOT TESTED | NOT TESTED | |
| A09 | EXIF 1–8 | Upload the eight orientation fixtures → every thumbnail and detail image is upright | NOT TESTED | NOT TESTED | |
| A10 | Mirrored 2/4/5/7 | The mirrored fixtures are shown un-mirrored (text in the image reads left-to-right) | NOT TESTED | NOT TESTED | |
| A11 | Large photo | An ~8000 px photo is resized (longest side ≤ 4096) and uploads without running out of memory | NOT TESTED | NOT TESTED | |
| A12 | Metadata removal | Upload a photo with GPS EXIF → download the stored original from the backend storage → no EXIF/GPS left | NOT TESTED | NOT TESTED | |
| A13 | Process death / lost picker data | Developer options → "Don't keep activities" → pick a photo → the app recovers (lost picker data is retrieved or a clear "choose again" state; no crash) | NOT TESTED | NOT TESTED | |
| A14 | Interrupted upload | Start an upload, switch on airplane mode or kill the app mid-upload → reopen → the pending upload is recovered once (same Idempotency-Key), never duplicated | NOT TESTED | NOT TESTED | |
| A15 | Location permission | Home → "Ob-havoni ko‘rish" → prompt appears only after the tap → allow → weather shown | NOT TESTED | NOT TESTED | |
| A16 | Coarse location | The prompt offers approximate location only (no "precise" toggle requested); weather works with approximate | NOT TESTED | NOT TESTED | |
| A17 | Denied | Deny once → manual city offered; weather for the chosen city works | NOT TESTED | NOT TESTED | |
| A18 | Permanently denied | Deny twice ("don't ask again") → no prompt; "Sozlamalar" opens app settings | NOT TESTED | NOT TESTED | |
| A19 | Location service off | Turn location off system-wide → clear message, manual city offered, settings link works | NOT TESTED | NOT TESTED | |
| A20 | Location timeout | Indoors / no fix → times out (bounded) → manual city offered; no endless spinner | NOT TESTED | NOT TESTED | |
| A21 | Secure storage | Sign in → force-stop → reopen → still signed in; `adb backup`/device transfer does not carry tokens (backup disabled) | NOT TESTED | NOT TESTED | |
| A22 | Keystore | Clear app data → signed out; reinstall → signed out (no token survives) | NOT TESTED | NOT TESTED | |
| A23 | App restart | Kill and restart during each main screen → app restores the session and lands on Home | NOT TESTED | NOT TESTED | |
| A24 | Airplane mode | Airplane mode on → offline banner; cached screens stay; no data lost; off → GETs resume; no POST is repeated automatically | NOT TESTED | NOT TESTED | |
| A25 | Expired token | Leave the app idle beyond the access-token lifetime (or use a backend with a short `ACCESS_TOKEN_TTL_SECONDS`) → the next action refreshes silently, once | NOT TESTED | NOT TESTED | |
| A26 | 401 recovery | Revoke the session on the server (log out elsewhere / delete the session) → the app goes to sign-in with the right reason, no loop | NOT TESTED | NOT TESTED | |
| A27 | Signed media | Leave an item open past the signed-URL expiry → images reload with fresh URLs; no broken images | NOT TESTED | NOT TESTED | |
| A28 | Large image memory | Scroll a wardrobe of 50+ items with large photos → no OOM, smooth scrolling | NOT TESTED | NOT TESTED | |
| A29 | Keyboard / chat | Stylist chat: keyboard opens, input stays visible, send works; rotating or resizing keeps the draft | NOT TESTED | NOT TESTED | |
| A30 | 2× text | System font size at maximum (or 200 %) → every screen readable, no clipped buttons, chat input usable | NOT TESTED | NOT TESTED | |
| A31 | TalkBack | Main screens with TalkBack: every button announced; thumbnails not announced separately | NOT TESTED | NOT TESTED | |
| A32 | Release logs | Release build: `adb logcat` shows no app logs (no tokens, URLs, images, profile, location or chat text) | NOT TESTED | NOT TESTED | |
| A33 | Account deletion | Profile → delete account → type the confirmation → signed out with "Hisobingiz o‘chirildi."; sign-in with the old account fails; another user on the same device is unaffected | NOT TESTED | NOT TESTED | |
| A34 | Selfie analysis | Profile → colour profile → consent screen before any permission prompt → front camera → result shown; no selfie file left in the app's cache | NOT TESTED | NOT TESTED | |

## iOS

**Needs a Mac with Xcode and a physical iPhone.** Nothing below has been run. The Linux environment used to build this release can't build or sign iOS.

| ID | Area | Check (steps → expected) | Result | Notes |
|---|---|---|---|---|
| I01 | Real build | `flutter build ios --release --dart-define-from-file=config/staging.json` succeeds on macOS | NOT TESTED | |
| I02 | Debug build | `flutter run` on a simulator and on a device with `config/development.json` (`http://localhost:3000`) | NOT TESTED | |
| I03 | Release archive | Xcode → Product → Archive succeeds; the archive validates in the Organizer | NOT TESTED | |
| I04 | Signing | Team, bundle id `uz.atlas.app`, provisioning profile and distribution certificate are correct; the archive is signed for App Store / TestFlight | NOT TESTED | |
| I05 | Camera permission | Add item → Camera → `NSCameraUsageDescription` prompt shown only now; deny → clear message | NOT TESTED | |
| I06 | Photo library permission | Add item → Gallery → limited/full library and PHPicker behave; `NSPhotoLibraryUsageDescription` text is correct | NOT TESTED | |
| I07 | HEIC | Pick a HEIC photo (iPhone default) → converted to JPEG, uploads, upright | NOT TESTED | |
| I08 | Image picker | Camera and gallery return images; cancelling returns to the screen without errors | NOT TESTED | |
| I09 | Keychain persistence | Sign in → kill → reopen → signed in. Delete and reinstall → record whether the session survives (Keychain items can outlive the app); if it does, it must still be validated with the server (refresh) before use | NOT TESTED | |
| I10 | Location permission | "When in use" prompt only after the tap; approximate location works; denied → manual city | NOT TESTED | |
| I11 | App lifecycle | Background → foreground: stale weather refreshes; session restored; no duplicate requests | NOT TESTED | |
| I12 | Privacy manifest | `PrivacyInfo.xcprivacy` present for the app and required-reason APIs declared (including plugins); Xcode privacy report has no errors | NOT TESTED | |
| I13 | Export compliance | `ITSAppUsesNonExemptEncryption` set correctly (the app uses only standard HTTPS); App Store Connect accepts the build | NOT TESTED | |
| I14 | VoiceOver / Dynamic Type | Main screens with VoiceOver and the largest text size | NOT TESTED | |
| I15 | Release logs | Release build: Console.app shows no app logs | NOT TESTED | |

## Sign-off

| | Name | Date | Result |
|---|---|---|---|
| Android | | | |
| iOS | | | |
