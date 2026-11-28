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
- A37–A38 need password reset e-mail on the staging server (`MAIL_TRANSPORT=smtp` and a working SMTP account, [`docs/deploy/staging.md`](../deploy/staging.md) section 2); A39 needs `MAIL_TRANSPORT=disabled`.
- A41–A42 call the real AI providers: every photo analysis, stylist question and outfit explanation is a billed request. Set the spending limits at the providers before the run.
- A45 needs `adb`. Its native-crash and ANR steps need a debug build (`run-as` works only for a debuggable app) on Android 11+.

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
| A35 | Consent at registration | Register → the account can't be created until both boxes are ticked (privacy policy; terms of use and 18+); the document links open the texts and back returns to the form with the input kept | NOT TESTED | NOT TESTED | |
| A36 | Legal documents | Profile → "Huquqiy hujjatlar" → both documents open and are readable at 2× text; the "Loyiha: …" notice shows while the texts are drafts | NOT TESTED | NOT TESTED | |
| A37 | Forgot password | Sign-in → "Parolni unutdingizmi?" → an existing and an unknown address get the same confirmation; the e-mail for the existing one arrives within a minute (check spam) with an `https://<staging host>/reset-password?token=…` link | NOT TESTED | NOT TESTED | |
| A38 | Reset round trip | Open the link on the phone → set a new password → the phone that was signed in keeps working until its access token expires (at most 15 min), then its next action signs it out with "Sessiya yakunlangan…"; the new password signs in; the same link again → "Havola yaroqsiz yoki muddati tugagan…" | NOT TESTED | NOT TESTED | |
| A39 | Reset unavailable | Staging with `MAIL_TRANSPORT=disabled`: "Parolni unutdingizmi?" → "Parolni tiklash hozircha ishlamayapti…" | NOT TESTED | NOT TESTED | |
| A40 | Crash reports | After the run, on the server: `deploy/compose.sh logs web \| grep '"client error"'` → one line per distinct error per app run, with platform, app version and route; no e-mail address, token or URL query in any line. Attach the lines to the run | NOT TESTED | NOT TESTED | |
| A41 | Real AI: photos | Real vision provider: a clear photo of one garment → sensible category and colour; a strongly blurred photo → "Rasm aniq emas…", no item created | NOT TESTED | NOT TESTED | |
| A42 | Real AI: stylist, outfits | Stylist question in Uzbek → the answer is in Uzbek and names only items from the wardrobe; outfit generation → explanation in Uzbek; each request has an `ai.call` log line with the provider, model and cost estimate | NOT TESTED | NOT TESTED | |
| A43 | Mobile data | Wi-Fi off, 4G/LTE: sign in, camera upload and a stylist question work; a slow answer shows progress and ends with an answer or a clear error, never an endless spinner | NOT TESTED | NOT TESTED | |
| A44 | Changed legal texts | On staging, make the account's consent older than the server's `legal.MinConsentVersion` (`UPDATE "LegalConsent" SET "version" = '2020-01-01.1' WHERE "userId" = …`) → at the next start, or at the next request of an open app, "Hujjatlar yangilandi" opens and nothing else does; the documents open from it; "Qabul qilaman" with both boxes ticked continues to the app (an account that never finished onboarding: to onboarding); "Chiqish" signs out; "Rozi emasman — hisobni o‘chirish" opens account deletion | NOT TESTED | NOT TESTED | |
| A45 | Crashes outside Dart | `adb shell am crash uz.lookly.app` → the app closes; open it again → within seconds the server log has one `client error` line with `"kind":"android_java"`, `"fatal":true`, the app version and an `errorType` of `android.app.RemoteServiceException…` (message `shell-induced crash`); the start after that sends nothing new. Android 11+ (not the API 29 device), debug build: `adb shell run-as uz.lookly.app kill -SEGV $(adb shell pidof uz.lookly.app)` → open again → `"kind":"android_native"` with `SIGSEGV` (on Android 12+ also `#00 pc …` frames); `adb shell run-as uz.lookly.app kill -STOP $(adb shell pidof uz.lookly.app)`, tap the screen until "ATLAS isn't responding" → Close app → open again → `"kind":"android_anr"`. No line holds an e-mail address or a token | NOT TESTED | NOT TESTED | |
| A46 | Background removal | Add a garment from the camera on a plain and on a busy background → after "Rasm tayyorlanmoqda…" the preview shows the garment on a light background, cropped to it, with "Fonni olib tashlash" switched on; switching it off shows the original photo; upload either one → the wardrobe tile shows that version. Airplane mode right after a fresh install (model not downloaded yet) → the original photo and no switch, no error. A photo of a wall or the floor → the original photo, no switch | NOT TESTED | NOT TESTED | |
| A47 | Icon and brand | Launcher icon: the light "L" ribbon on the violet tile, named "Lookly" (also round and themed icons on Android 13+); while the app starts, the light screen with the coloured mark, then the splash with the same mark and "Lookly" without a flash between them; sign-in shows the mark and wordmark on the dark violet hero | NOT TESTED | NOT TESTED | |

## iOS

**Needs a Mac with Xcode and a physical iPhone.** Nothing below has been run. The Linux environment used to build this release can't build or sign iOS.

| ID | Area | Check (steps → expected) | Result | Notes |
|---|---|---|---|---|
| I01 | Real build | `flutter build ios --release --dart-define-from-file=config/staging.json` succeeds on macOS | NOT TESTED | |
| I02 | Debug build | `flutter run` on a simulator and on a device with `config/development.json` (`http://localhost:3000`) | NOT TESTED | |
| I03 | Release archive | Xcode → Product → Archive succeeds; the archive validates in the Organizer | NOT TESTED | |
| I04 | Signing | Team, bundle id `uz.lookly.app`, provisioning profile and distribution certificate are correct; the archive is signed for App Store / TestFlight | NOT TESTED | |
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
| I16 | Consent, reset, crash reports | A35–A40 and A44 on the iPhone; the reset link opens in Safari | NOT TESTED | |

## Sign-off

| | Name | Date | Result |
|---|---|---|---|
| Android | | | |
| iOS | | | |
