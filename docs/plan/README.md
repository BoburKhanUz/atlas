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
| B5 | Weather, outfit engine, outfits | Engine golden vectors 100% equal; outfit e2e specs pass |
| B6 | AI: providers, vision, stylist, jobs, monitoring, `eval` command | AI e2e specs pass with mock providers; offline evaluation tests pass against Go |
| B7 | Cutover: web calls Go, Prisma retired, old API removed | All Playwright specs green against Go; phone checked on staging |
| B8 | Admin API | Admin role enforced (tested); actions audited |
| B9 | Sign-up and sign-in (owner decision, 2026-11-25; after the cutover, so it is written once, in Go): email verification by a code sent at registration; sign-in with a phone number and an SMS code. The SMS sender is an interface with one adapter per provider, chosen by configuration, so providers can be swapped without touching the sign-in code. Needs a contract change, the mail sender from B3, an SMS provider account (owner), and per-number and per-IP limits before SMS is enabled (each message costs money) | Contract and clients updated; a fake SMS adapter in tests and at least one real adapter checked on staging with the owner's approval; abuse limits tested; the app's screens (see M8) |

## Mobile (Flutter, `apps/mobile`)

| Stage | Goal | Exit criteria |
|---|---|---|
| M1 | Fix the audited defects (2 high, 7 medium, 2 low) — details in `M1.md`; started at `523e6af`, **done** 2026-11-25 (review, re-review and security gate recorded in `M1.md`) | Each defect has a failing-then-passing test |
| M2 | Structure: shared code to `core`, no cross-feature imports, logic out of widgets, domain models | Cross-feature import check in CI; all tests green |
| M3 | Localization: `gen_l10n`, Uzbek Material localizations, strings to ARB | No literal user-facing strings (CI check) |
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
