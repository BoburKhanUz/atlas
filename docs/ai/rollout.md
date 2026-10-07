# AI rollout foundation (PHASE 5.0)

Status: **implemented and tested offline.** Real AI stays disabled in production. Phase 5.0 adds the controls that a later, separately approved phase can use to turn it on gradually. It does not turn anything on, select a provider or change a provider default.

Related: [`provider-architecture.md`](provider-architecture.md) (configuration), [`monitoring.md`](monitoring.md) (`disabled` outcome), [`staging.md`](staging.md), [`privacy.md`](privacy.md).

## Feature switches

| Variable | Feature | Production default | Development / test default |
|---|---|---|---|
| `AI_STYLIST_ENABLED` | stylist chat (`stylist_chat`) | **off** | on |
| `AI_VISION_ENABLED` | clothing analysis (`clothing_analysis`) | **off** | on |
| `AI_OUTFIT_AI_ENABLED` | outfit AI ranking and explanation (`outfit_explanation`) | **off** | on |

- Values: `true`, `false`, `1` or `0` (any case). A blank value counts as missing.
- **Malformed values refuse to start** in every environment (`AI_STYLIST_ENABLED must be true, false, 1 or 0`), so a typo can never turn AI on.
- **Production fails closed:** a missing switch is off.
- Development and test default to on, so the Phase 4 behaviour and the mock flows are unchanged. The e2e suite runs a production build, so it sets every switch explicitly (`playwright.config.ts`).
- The switches only narrow access. They never relax the existing production rules: a mock still needs `AI_ALLOW_MOCK_IN_PRODUCTION=1`, and a real provider still needs its key and model. Both are enforced by `parseAiConfig` before any request.

When a feature is off, or the user is outside the rollout:

| Feature | Path | Provider call | Quota | Stored |
|---|---|---|---|---|
| Stylist | `503 AI_UNAVAILABLE` (the existing contract), **no mock substitute** | none | not charged | nothing |
| Vision | the existing deterministic analysis, marked `mock: true`; the user confirms or edits as before | none | not charged | the item, as with the mock |
| Outfit AI | the deterministic engine's order and explanations (`fallback: true`) | none | not charged | as before |

## Percentage rollout

`AI_ROLLOUT_PERCENT`: a whole number from 0 to 100.
- **Production default 0.** Development and test default 100.
- Anything else refuses to start: negative, above 100, decimals, `50%`, `1e2`, words.

Each user has a stable bucket:

```
bucket = uint32_be(sha256("atlas-ai-rollout:v1:" + userId)[0..4]) mod 100
eligible  ⇔  bucket < AI_ROLLOUT_PERCENT
```

- **Deterministic:** the bucket depends on the user id only. It does not use randomness, time, request order, process or host.
- **Monotonic:** raising the percentage only adds users. Nobody selected at 10 % drops out at 25 %.
- The namespace `v1` can be changed to reshuffle every bucket, giving a new rollout population.
- Distribution was checked on 20 000 synthetic ids: within 2 percentage points at 1, 10, 50 and 99 %.

## Allowlist

`AI_ROLLOUT_ALLOWLIST` is a comma-separated list of **allowlist digests**, never raw user ids:

```
digest = hex(sha256("atlas-ai-allowlist:v1:" + userId))   # 64 hex characters
cd apps/web && bun scripts/ai-rollout-digest.ts <userId> [<userId> …]
```

- Entries are trimmed and lower-cased; empty entries are ignored. The list holds at most 1000 entries.
- A raw id or any other value refuses to start. The error message never echoes the entry.
- The digest uses a different namespace from the bucket, so a digest does not reveal a bucket.
- **The allowlist only skips the percentage.** It does not bypass:
  - the feature switch;
  - production fail-closed;
  - the quota (an allowlisted user at the limit still gets `429 AI_QUOTA_EXCEEDED`, and vision still gets `quota_exceeded`);
  - validation, monitoring or privacy.

## Decision order

`decideAiEligibility(feature, userId)` in `apps/web/src/lib/ai/rollout.ts`:

1. **AI configured, production fail-closed.** Enforced at startup by `parseAiConfig`. A misconfigured server does not start, so there is nothing to decide.
2. **Feature switch off** → not eligible (`feature_disabled`).
3. **User on the allowlist** → eligible (`allowlisted`).
4. **Bucket < percentage** → eligible (`rollout_selected`).
5. **Otherwise** → not eligible (`rollout_not_selected`). The non-AI path is used.

The module decides eligibility only. It calls no provider, database or quota, and it reads no prompt. Every service checks eligibility **before** any provider work, mock included:
- `runStylistTurn`;
- `analyzeGarment`;
- `rerankAndExplain`.

An eligible request then follows the unchanged Phase 4 path: quota, provider, validation, correction, monitoring.

## Monitoring and privacy

- The existing `ai.request` event carries the decision:
  - `outcome: "disabled"`;
  - `reason: "feature_disabled"` or `"rollout_not_selected"`;
  - `billable: false`.
- No new field and no new event.
- `disabled` is logged at info level. It is not a failure in the dashboard or the alerts.
- It is also excluded from the outfit fallback-rate denominator, so a partial rollout does not dilute that alert.
- The user id is only hashed. It is never returned, logged or emitted. Neither are the bucket, the digest or the allowlist.
- The decision object holds only `eligible` and a fixed reason code.

## Operating it (later phases)

These steps need explicit approval of a later phase. They are not part of Phase 5.0.

1. Configure the provider in staging, then run the [staging smoke](staging.md).
2. Production: switches on for one feature, `AI_ROLLOUT_PERCENT=0`, and the allowlist holding the internal testers' digests.
3. Raise the percentage in steps, watching [monitoring](monitoring.md) between steps.
4. Rollback: set the switch to `false` (or the percentage to `0`) and restart. Users fall back to the non-AI path immediately. Stored data needs no migration.

## Tests

| Test | What it covers |
|---|---|
| `tests/unit/ai/rollout.test.ts` | switches (enabled, disabled, missing, malformed, production, development, test); percentages 0/1/10/50/99/100 and invalid values; allowlist parsing with no echo; determinism over 100 evaluations; distribution; monotonicity; decision order; no id in the decision |
| `tests/regression/ai-rollout.test.ts` | stylist, vision and outfit through their routes: off or 0 % gives no provider call, no quota and nothing stored; no mock substitute; allowlisted at 0 % is served; allowlist with the switch off is refused; allowlist with exhausted quota gets 429 or `quota_exceeded`; percentage by bucket; outfit off is identical to the deterministic reference; telemetry carries no user id, digest or allowlist |
| `tests/integration/ai-rollout.itest.ts` | real PostgreSQL and quota: the allowlisted insider is charged and stored; the outsider is refused, uncharged and nothing is stored; the switch off refuses the allowlisted user |
| `tests/unit/ai/monitoring.test.ts` | `disabled` does not dilute the outfit fallback alert |
