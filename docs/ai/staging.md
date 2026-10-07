# Staging environment contract and smoke test (PHASE 5.0)

Status: **foundation only.** The smoke test exists. It runs in mock mode inside the normal e2e suite and has been run locally against a production build through the staging config. **There is no staging environment yet** (STAGING INFRASTRUCTURE REQUIRED). No real provider has been called. This document lists the names and rules of the staging settings, never their values.

Related: [`rollout.md`](rollout.md), [`monitoring.md`](monitoring.md), [`provider-evaluation.md`](provider-evaluation.md), [`privacy.md`](privacy.md).

## Environment contract

Staging runs the production build (`NODE_ENV=production`), so the production rules apply in full: fail-closed, no implicit mock, and switches off unless set.

| Area | Variables | Staging rule |
|---|---|---|
| Provider | `AI_LLM_PROVIDER`, `AI_VISION_PROVIDER` | `mock` for a mock smoke (with `AI_ALLOW_MOCK_IN_PRODUCTION=1`), or `gemini` / `openai` for a real smoke. The choice is per environment and made by a human; there is no automatic selection and no cross-provider fallback. |
| Model | `AI_LLM_MODEL`, `AI_VISION_MODEL` | Required for a real provider. There is no built-in default. The model is recorded with each smoke run. |
| Keys | `GEMINI_API_KEY` / `OPENAI_API_KEY` | Only in the deployment's secret store, staging-only, with a spending cap at the provider. Never in the repository, in CI or on the smoke runner. |
| Switches | `AI_STYLIST_ENABLED`, `AI_VISION_ENABLED`, `AI_OUTFIT_AI_ENABLED` | All `true` for the full smoke. Leaving one off makes its step answer through the non-AI path, and the smoke reports it. |
| Rollout | `AI_ROLLOUT_PERCENT` | `100` for a smoke with fresh users. With a lower value, the smoke must use an allowlisted account (below). |
| Allowlist | `AI_ROLLOUT_ALLOWLIST` | Digests only (`scripts/ai-rollout-digest.ts`), for example the dedicated smoke account. Never raw ids. |
| Quota | code constants `AI_DAILY_LIMITS` in `src/lib/ai/quota.ts` (stylist 50, vision 50, colour 10, outfit AI 30 per user per day) | Unchanged. A full smoke charges at most 1 stylist turn, 3 analyses and 1 outfit explanation per run. |
| Monitoring destination | `LOG_LEVEL` (default `info`), stdout JSON lines | The deployment's log collector keeps the `ai.*` lines. `scripts/ai-monitor.ts` reads the exported lines. A metrics backend is still to be chosen ([`monitoring.md`](monitoring.md)). |
| Other | `DATABASE_URL`, `JWT_SECRET`, `MEDIA_SIGNING_SECRET`, `SESSION_ENC_KEY`, storage, `WEATHER_PROVIDER` | As for production, with staging-only secrets and a staging-only database. |

Data rules:
- Staging holds synthetic accounts and synthetic images only. No real user data and no real selfies.
- The smoke deletes a fresh account at the end.
- With a dedicated account, the smoke deletes the items and the colour profile. The stylist conversation stays, because there is no conversation delete endpoint; it holds synthetic text only.

## Smoke test

- Files:
  - `apps/web/e2e/smoke/staging-smoke.spec.ts`;
  - `apps/web/e2e/smoke/smoke-mode.ts` (mode gate and log check);
  - `apps/web/playwright.staging.config.ts`.
- It runs at API level as one test with a step per area.

| Step | Checks |
|---|---|
| health and config | `/api/health` returns `ok` and the database is `ok`; the OpenAPI document is served |
| auth | anonymous `401`; register (or log in to the dedicated account); `me` |
| wardrobe upload and vision | 3 synthetic garments (rendered by `synthetic-vision.ts`); `detection.mock` must match the mode. Mock: exact categories. Real: a controlled `NOT_A_GARMENT` refusal is accepted and annotated. |
| colour profile | synthetic selfie, deterministic (no provider): `spring` / `warm` |
| stylist | `200` with a non-empty answer. `503 AI_UNAVAILABLE` fails with the hint "feature off or user outside the rollout". |
| outfit generation and AI explanation | `200`; every outfit has an explanation. Mock: `fallback: true` (deterministic). Real: `fallback: false` expected (soft assertion, reported). |
| failure behaviour | empty message → `400 VALIDATION_ERROR`; a non-image → controlled 4xx. No public error contains a provider name, key, stack or database detail. |
| monitoring, quota and privacy | with `STAGING_SMOKE_LOG_FILE`: `ai.request` events for all three features in the run window; providers match the mode; quota charged 0 for mock and > 0 for real; the user's email, password, ids, conversation id and message text appear nowhere in the log. Without a log file, the step is skipped and annotated. |
| cleanup | deletes the fresh account, or the dedicated account's items and colour profile |

### Mock vs real

| | Mock (default) | Real |
|---|---|---|
| Select | `STAGING_SMOKE_PROVIDER=mock` or unset | `STAGING_SMOKE_PROVIDER=real` **and** `STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1` |
| CI | yes: the normal e2e suite runs it against the local production build | **never:** `smokeMode` refuses when `CI` is set, and no workflow references the staging config (asserted in `staging-smoke.test.ts`) |
| Cost | none | the target's provider budget; about 5 billable requests per run |
| Distinguished by | `detection.mock === true`; `ai.request` provider `mock`; no quota charge | `detection.mock === false`; real provider names; quota charged |

The runner never holds a provider key; it only talks to the target over HTTP. A run in one mode against a target in the other mode fails at the vision step. This was verified locally against the mock build.

### Running it

```bash
cd apps/web
# mock target
STAGING_BASE_URL=https://<staging host> bunx playwright test -c playwright.staging.config.ts
# with the target's exported log lines for the monitoring and privacy step
STAGING_BASE_URL=… STAGING_SMOKE_LOG_FILE=/path/outside/repo/staging.log bunx playwright test -c playwright.staging.config.ts
# real provider (manual, never CI); a lower rollout needs the allowlisted smoke account
STAGING_BASE_URL=… STAGING_SMOKE_PROVIDER=real STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1 \
  STAGING_SMOKE_EMAIL=… STAGING_SMOKE_PASSWORD=… bunx playwright test -c playwright.staging.config.ts
```

- The report goes to `playwright-report-staging/` (git-ignored).
- Traces and screenshots are off, so no response body is kept.
- Record the provider, model, rollout percentage and date with each real run.
