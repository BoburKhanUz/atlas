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
| Project rules, skills, ADRs, CI checks | `CLAUDE.md`, 7 skills and ADRs 0001–0007 in the repo; skills reviewed by a fresh agent and findings fixed; `repo-rules` CI job green | `e939067` | in progress |

## Backend (Go, `apps/api`)

| Stage | Goal | Exit criteria |
|---|---|---|
| B0 | Skeleton: module, config, logging, error envelope, health, CI job, Dockerfile. Starts with a spike: generate the server interface from the OpenAPI 3.1 contract with oapi-codegen; if 3.1 support is not enough, choose the workaround (as the Dart client does with `prepare_spec.dart`) and record it in an ADR | CI job green; missing config stops the server (tested); codegen approach recorded |
| B1 | Data layer: sqlc queries, migration tool, River tables, scheduled cleanup jobs | See ADR 0007; Go schema equals the Prisma schema (checked in CI) |
| B2 | Auth and sessions | 9 session vectors and the session e2e specs pass against Go |
| B3 | Profile, consent, password reset, mail, account deletion | Their e2e specs pass against Go |
| B4 | Wardrobe and media, R2 driver, upload limits and quotas | Wardrobe e2e specs pass; refusal paths tested |
| B5 | Weather, outfit engine, outfits | Engine golden vectors 100% equal; outfit e2e specs pass |
| B6 | AI: providers, vision, stylist, jobs, monitoring, `eval` command | AI e2e specs pass with mock providers; offline evaluation tests pass against Go |
| B7 | Cutover: web calls Go, Prisma retired, old API removed | All Playwright specs green against Go; phone checked on staging |
| B8 | Admin API | Admin role enforced (tested); actions audited |

## Mobile (Flutter, `apps/mobile`)

| Stage | Goal | Exit criteria |
|---|---|---|
| M1 | Fix the audited defects (2 high, 9 medium) | Each defect has a failing-then-passing test |
| M2 | Structure: shared code to `core`, no cross-feature imports, logic out of widgets, domain models | Cross-feature import check in CI; all tests green |
| M3 | Localization: `gen_l10n`, Uzbek Material localizations, strings to ARB | No literal user-facing strings (CI check) |
| M4 | Design system: dark theme tokens, haptics, transitions, text scale to 2.0, portrait lock | Golden tests: main screens light and dark, 360dp, text scale 1.0 and 2.0 |
| M5 | Screens redesigned from the approved mockups | Owner approves each screen |
| M6 | Device testing: `integration_test/`, Android device, iPhone via TestFlight (macOS CI job) | Integration tests pass on both platforms |
| M7 | Release readiness | `lookly-release` checklist complete |

## Web and admin (`apps/web`)

| Stage | Goal | Exit criteria |
|---|---|---|
| W1 (within B7) | Web pages call the Go API only | No server module imported by pages; e2e green |
| W2 | Admin panel UI | Admin Playwright specs green |

## Final

| Stage | Goal | Exit criteria |
|---|---|---|
| F1 | Final quality audit | All security gates, performance measurements, device checks; no open blocking finding |
