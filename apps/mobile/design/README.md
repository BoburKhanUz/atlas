# Design references

Kept here, not under `docs/`: no image may be tracked under `docs/` (a test in
`apps/web/tests/unit/ai/real-data-validation.test.ts` keeps evaluation photos out of Git).
The app does not bundle this folder; its assets are under `assets/`.

Mockups the owner brought or approved, kept as the reference a stage builds to.
A mockup is a picture, not a specification: the app is built with its own design
tokens (`apps/mobile/lib/core/design/tokens.dart`), font (Manrope) and brand mark
(`apps/mobile/assets/brand/mark.png`), so colours, type and spacing follow the app
where the picture differs.

| File | Stage | Status | Notes |
|---|---|---|---|
| `m3-language-screen.jpg` | M3 | brought by the owner 2026-11-27 (made with ChatGPT); direction accepted, details open | The logo in the picture is not the Lookly mark: the app uses its own mark. The illustration is `m3-language-illustration.png`. Open with the owner: flags beside the languages, and the line under each language name. The title and the button follow the chosen language as soon as it is tapped. On small screens and at large text the illustration shrinks or is left out, so that the three choices and the button stay visible. |
| `m3-language-illustration.png` | M3 | brought by the owner 2026-11-27 (made with ChatGPT) | The illustration of the language screen, 1448×1086, enough for a phone 3× wide. Its background is near-white (#FDFDFD), not transparent: on the app's background (#FAF9FF) its edge would show, so M3 either cuts the background out or gives the screen a white background. In the app as WebP (about 60 KB). |
| `m3-language-profile.jpg` | M3 | brought by the owner 2026-11-27 | The language setting in the profile: UZ/EN/RU badges, "Telefoningiz tili" under the proposed language. |
| `m5-intro-1-photo.jpg`, `m5-intro-2-outfit.jpg`, `m5-intro-3-stylist.jpg` | M5 | brought by the owner 2026-11-27 | The three intro slides. Text drawn into the illustrations (the chat question, "+18°") cannot be translated: the app draws such text itself over illustrations without text, which have to be supplied at full resolution. |
| `m5-about.jpg` | M5 | brought by the owner 2026-11-27 | "About and help". The Telegram and email contacts and the questions-and-answers content are the owner's to give. |
| `m7-update-required.jpg` | M7 | brought by the owner 2026-11-27 | The update screen. The picture has a typo ("br" for "bir") and a white background; the app uses its own text and background. Its illustration has to be supplied at full resolution. |
| `m8-email-code.jpg`, `m8-phone-sign-in.jpg`, `m8-sms-code-error.jpg`, `m8-password-change.jpg`, `m8-password-reset-code.jpg` | M8 | brought by the owner 2026-11-27 | Codes and passwords. The password checklist shows the server's rules as they are (today: at least 8 characters); "letter and digit" is a new rule only if the owner decides it. The country code selector stays at +998 unless the owner decides to send SMS abroad. |
