# Development plan: stages and exit criteria

Approved by the owner on 2026-11-25 (full plan, in Uzbek:
https://claude.ai/artifact/UFCAeN9wxQ3k1wvFnTT1AX). This file is the working copy
for agents: each stage's goal, exit criteria and the commit it started from.
Update the "Started at" and "Status" columns when a stage starts or ends.

Every stage ends with the stage gate in `.claude/skills/lookly-workflow/SKILL.md`.
`lookly-code-review` diffs a stage against its "Started at" commit.

## S0 — Foundations

| Goal | Exit criteria | Started at | Status |
|---|---|---|---|
| Project rules, skills, ADRs, CI checks | `CLAUDE.md`, 7 skills and ADRs 0001–0007 in the repo; skills reviewed by a fresh agent and findings fixed; `repo-rules` CI job green | `e939067` | done (`ddaec99`, CI green) |

## Backend (Go, `apps/api`)

| Stage | Goal | Exit criteria |
|---|---|---|
| B0 | Skeleton: module, config, logging, error envelope, health, CI job, Dockerfile (spec `B0.md`; started at `409d7aa`, **done** 2026-11-25: review and security gate in `B0.md`). Starts with a spike: generate the server interface from the OpenAPI 3.1 contract with oapi-codegen; if 3.1 support is not enough, choose the workaround (as the Dart client does with `prepare_spec.dart`) and record it in an ADR | CI job green; missing config stops the server (tested); codegen approach recorded |
| B1 | Data layer: sqlc queries, migration tool, River tables, scheduled cleanup jobs (spec `B1.md`; started at `f7a9826`, **done** 2026-11-25: review and security gate in `B1.md`) | See ADR 0007; Go schema equals the Prisma schema (checked in CI) |
| B2 | Auth and sessions (spec `B2.md`; started at `aa42fbf`, **done** 2026-11-26: review and security gate in `B2.md`) | 9 session vectors and the session e2e specs pass against Go |
| B3 | Profile, consent, password reset, mail, account deletion (spec `B3.md`; started at `7f169e8`, **done** 2026-11-26: review and security gate in `B3.md`) | Their e2e specs pass against Go |
| B4 | Wardrobe and media, R2 driver, upload limits (spec `B4.md`; started at `2b1ed74`, **done** 2026-11-27: review and security gate in `B4.md`; limits 100 uploads a day and 1000 items: owner decision 2026-11-26; the `r2` driver still to be run against a staging bucket of the owner's) | Wardrobe e2e specs pass; refusal paths tested |
| B5 | Weather, outfit engine, outfits (spec `B5.md`; started at `2b4ec7e`, **done** 2026-11-27: review and security gate in `B5.md`; limits decided in the stage and told to the owner, who may change them: 20 generations a minute per user, 30 questions to the weather service an hour per user and 300 for everyone) | Engine golden vectors 100% equal; outfit e2e specs pass |
| B6 | AI: providers, vision, stylist, colour profile, monitoring, `eval` command (spec `B6.md`; started at `f1cded3`, in progress; AI calls stay in the request: ADR 0011) | AI e2e specs pass with mock providers; offline evaluation tests pass against Go |
| B7 | Cutover: web calls Go, Prisma retired, old API removed | All Playwright specs green against Go; phone checked on staging |
| B8 | Admin API | Admin role enforced (tested); actions audited |
| B9 | Sign-up and sign-in (owner decision, 2026-11-25; after the cutover, so it is written once, in Go): email verification by a code sent at registration; sign-in with a phone number and an SMS code. The SMS sender is an interface with one adapter per provider, chosen by configuration, so providers can be swapped without touching the sign-in code. Needs a contract change, the mail sender from B3, an SMS provider account (owner), and per-number and per-IP limits before SMS is enabled (each message costs money) | Contract and clients updated; a fake SMS adapter in tests and at least one real adapter checked on staging with the owner's approval; abuse limits tested; the app's screens (see M8) |
| B10 | Server texts in three languages (needed by M3; after the cutover, so it is written once, in Go): the server answers in the language the app asks for (`Accept-Language`: uz, en, ru; Uzbek otherwise) for error messages, catalog labels, outfit explanations, weather words and emails; the user's language is stored in the profile (emails use it); `GET` of the country of the caller's address, from a GeoIP database kept on the server (no outside service is asked; the address is not stored or logged). Legal texts in English and Russian need a translation the owner provides (a lawyer's, not a machine's). The stylist's and the outfit explanation's AI prompts in English and Russian are new prompts: owner approval and an evaluation run first (rule 6) | Contract updated; each text has all three languages (test); the stored language read and changed through the profile; the country lookup tested with fixed addresses and with no database; prompts approved and evaluated |

## Mobile (Flutter, `apps/mobile`)

| Stage | Goal | Exit criteria |
|---|---|---|
| M1 | Fix the audited defects (2 high, 7 medium, 2 low) — details in `M1.md`; started at `523e6af`, **done** 2026-11-25 (review, re-review and security gate recorded in `M1.md`) | Each defect has a failing-then-passing test |
| M2 | Structure: shared code to `core`, no cross-feature imports, logic out of widgets, domain models | Cross-feature import check in CI; all tests green |
| M3 | Localization in three languages (owner decision, 2026-11-27): Uzbek, English, Russian. `gen_l10n`, every user-facing string to ARB in all three, Material and Cupertino localizations for each (Uzbek ones written for the system widgets Flutter has no Uzbek for). The language is proposed automatically: the phone's language when it is one of the three, else the country of the user's address (looked up by the server, see B10: Uzbekistan gives Uzbek; Russia, Kazakhstan, Kyrgyzstan, Tajikistan and Belarus give Russian; other countries English), else Uzbek. Without a network the phone's language or Uzbek is used. The first screen of a new install (before sign-in or sign-up) shows the three languages with the proposed one already chosen, so one tap continues; the user can change the language later in the profile (owner decisions, 2026-11-27). The choice is kept on the phone and, once signed in, in the user's profile on the server (B10), so that emails come in it too. The app sends its language to the server (`Accept-Language`) | No literal user-facing strings (CI check); every key present in all three ARB files (CI check); widget tests of the choice rules (phone language, country, neither, no network), of the first-launch language screen and of the change in the profile; main screens checked in each language at text scale 2.0 (Russian and English run longer) |
| M4 | Design system: dark theme tokens, haptics, transitions, text scale to 2.0, portrait lock | Golden tests: main screens light and dark, 360dp, text scale 1.0 and 2.0 |
| M5 | Screens redesigned from the approved mockups | Owner approves each screen |
| M6 | Device testing: `integration_test/`, Android device, iPhone via TestFlight (macOS CI job) | Integration tests pass on both platforms |
| M7 | Release readiness | `lookly-release` checklist complete |
| M8 | Screens for B9: enter the email code after registration; sign in with a phone number and an SMS code (resend timer, wrong and expired code, no network) | Widget tests for each state; owner approves the screens |

## Web and admin (`apps/web`)

| Stage | Goal | Exit criteria |
|---|---|---|
| W1 (within B7) | Web pages call the Go API only | No server module imported by pages; e2e green |
| W2 | Admin panel UI | Admin Playwright specs green |

## Final

| Stage | Goal | Exit criteria |
|---|---|---|
| F1 | Final quality audit | All security gates, performance measurements, device checks; no open blocking finding |
