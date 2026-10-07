# AI monitoring and alerts

Status: **implemented offline; no live provider data.** The events, the metrics and the alert rules exist and are tested with scripted providers and the mock.
- No Gemini or OpenAI call has produced a metric yet (LIVE / NOT TESTED).
- Production keeps real AI disabled and fails closed.
- Every threshold below is **INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF**.

| Label | Meaning |
|---|---|
| OFFLINE / MOCK | measured with the mock or scripted providers (tests, local) |
| LIVE / TESTED | measured with a real provider (none yet) |
| LIVE / NOT TESTED | needs live credentials (all provider metrics today) |
| PRODUCTION | real traffic (real AI not enabled) |

## Architecture

```
AI services ──► monitoring.ts ──► sanitizeAiEvent (whitelist) ──► sinks
 (client.ts, vision-service, stylist-service,                       ├─ logSink (default): one JSON log line per event
  outfit-intelligence, quota-monitoring, routes)                     └─ future: Prometheus / OpenTelemetry / cloud agent
                                                                         (setAiMonitoringSinks — the services do not change)

log lines ──► scripts/ai-monitor.ts ──► monitoring-metrics.ts (aggregate + alert rules) ──► dashboard (Markdown/JSON), exit 2 on alerts
```

- **No metrics backend, no new dependency.** ATLAS already writes structured JSON logs (`src/server/log.ts`), so metrics are log-based. Any log collector can count and percentile these fields.
- **`scripts/ai-monitor.ts`** produces the same dashboard and alert evaluation from a log file, for example from cron or after a bake-off.
- **No second logging system:** the existing `ai.call` line keeps its name and fields. Phase 4.x events (`ai.vision.result`, `ai.vision.invalid_output`, `ai.stylist.failed`, `ai.outfit.fallback`) stay as they were.

```bash
cd apps/web
bun scripts/ai-monitor.ts --input=server.log [--from=2026-10-06T00:00:00Z --to=…] [--baseline=last-week.log] [--json]
```

## Events (schema version 2)

All events carry `environment` (`production`, `development`, `test` or `unknown`) and `schemaVersion` (2).

### `ai.call` — one per provider call through `client.ts`

| Field | Type | Meaning |
|---|---|---|
| `feature` | code | `stylist_chat`, `clothing_analysis`, `outfit_explanation` (also `color_analysis` with provider `deterministic`: in-process, no AI provider) |
| `provider`, `model` | code / model id | who answered (`gemini`, `openai`, `mock`, `deterministic`) and the configured model |
| `outcome` | code | `ok`, an error kind, or `error` (a non-provider bug) |
| `success` | boolean | `outcome === 'ok'` |
| `errorCode` | code | failures only: `timeout`, `network`, `rate_limited`, `unavailable`, `auth`, `config`, `invalid_request`, `malformed_response`, `content_filtered`, `cancelled`, `provider_error`, `error` |
| `httpStatus` | number | failures only, when the provider answered with HTTP (no body, ever) |
| `latencyMs` | number | the whole provider operation from the application's view, including the retry wait (monotonic clock) |
| `attempts`, `retried` | number, boolean | 1 or 2 |
| `retry` | code | `none` (one attempt), `succeeded` (retried, then ok) or `failed` (retried, still failed) |
| `usageInput`, `usageOutput`, `usageTotal` | number | provider-reported token counts, **only when the response includes them**; never estimated |
| `costUsd` | number | only when `AI_*_PRICE_*_USD_PER_MTOK` is configured **and** both token counts exist |

### `ai.request` — one per feature request (what the user got)

| Field | Type | Meaning |
|---|---|---|
| `feature`, `provider`, `model` | code | as above (the model is the configured one) |
| `outcome` | code | `ok`, `fallback` (outfit: deterministic order), `ai_unavailable`, `quota_exceeded`, `not_a_garment`, `image_rejected`, `replay` (idempotent replay: no call, no charge), `internal_error` |
| `reason` | code | why: `provider_<errorCode>`, `malformed_output`, `ungrounded_after_correction`, `invalid_output`, `invalid_after_correction_<reason>`, `deadline`, `quota_exceeded`, `quota_error`, `mock_provider`, `content_filtered`, `unprocessable_image`, a vision subject (`multiple_garments`, …), `internal_error` |
| `corrected` | boolean | the single correction ran (stylist: ungrounded references; outfit: any invalid answer) |
| `billable` | boolean | the request consumed **and kept** a quota unit |
| `latencyMs` | number | total feature time (preparation, quota, provider, validation, correction) |

### `ai.quota` — one per quota decision (no user id)

| Field | Values |
|---|---|
| `action` | `charged`, `rejected` (limit reached), `refunded`, `store_error` (the quota store failed: `consume_failed` / `refund_failed`) |
| `reason` | for refunds: the failure reason (`provider_timeout`, `invalid_output`, `storage_failed`, …) |

## Privacy guarantees

Every event passes `sanitizeAiEvent`, a whitelist per event:
- Unknown keys are dropped.
- Strings must be short lowercase codes (`^[a-z0-9][a-z0-9_.:-]{0,63}$`: no spaces, so no sentences, prompts, answers or URLs). Model ids must match the configuration's model-id rule.
- Numbers must be finite and ≥ 0, and booleans stay booleans.

Even if a caller passed content by mistake, it could not be emitted.

**Never in telemetry:**
- prompts and system prompts;
- provider responses, AI answers and explanations;
- user messages and conversation history;
- wardrobe attributes or free text;
- images, image URLs, bytes, EXIF/GPS and file names;
- selfies;
- database, user, conversation or item ids;
- API keys, Authorization headers, cookies and tokens;
- request or response bodies.

**Tests:**
- `tests/unit/ai/monitoring.test.ts` (whitelist);
- `tests/regression/ai-monitoring.test.ts`: an adversarial user message, a tampered wardrobe row and malicious provider output, through both real adapters and all three features. The test checks the **emitted events and the real log lines** for forbidden content and non-whitelisted keys.
- `client-telemetry.test.ts` (exact `ai.call` field set) and `ai-prompt-injection.test.ts`.

## What is measurable now

Per feature × provider × model:
- calls, successes and failures; success rate;
- failures by error code and by HTTP status;
- timeouts and timeout rate;
- retries (none, succeeded, failed);
- latency p50 / p95 / p99 / max;
- token totals and p50/p95 (when reported), and cost (when priced).

Per feature × provider:
- request outcomes and reasons;
- corrections;
- billable requests;
- request latency p50/p95/p99;
- quota charged, rejected, refunded and store errors, plus the rejection rate.

Quota semantics are **unchanged**; the events only make them visible:

| Situation | Events |
|---|---|
| Real-provider success | `ai.quota charged` + `ai.request ok billable=true` |
| Provider/validation failure | `charged` → `refunded <reason>` + `ai.request … billable=false` |
| Limit reached | `ai.quota rejected` + `ai.request quota_exceeded` (outfit: `fallback quota_exceeded`); no `ai.call` |
| Invalid request (400) | no `ai.*` event at all (rejected before the AI service; never charged) |
| Idempotent replay | `ai.request replay billable=false`; no `ai.call`, no `ai.quota` |
| Mock | `provider=mock`, `billable=false`, no `ai.quota` |
| Vision `not_a_garment` / provider safety refusal | `billable=true` (the analysis ran; existing semantics) |
| Stylist answer generated but not stored | `ai.quota refunded storage_failed` |
| Colour analysis | no quota (deterministic, in-process; Phase 4.3) |

## Provider and model visibility

Every `ai.call` and `ai.request` names the provider and the model. That answers, per call:
- which provider and model handled it, and for which feature;
- whether it succeeded, how long it took, and whether it retried;
- which typed error it hit.

Selection stays environment-driven. There is **no automatic provider selection and no cross-provider fallback**.

## Tokens and cost

- **Tokens:** both adapters read the provider's usage block (Gemini `usageMetadata`, with thinking tokens counted as output; OpenAI `usage`). Only the numbers are recorded, and absent usage stays absent (tested).
- **Live availability: LIVE / NOT TESTED.** Token telemetry is unavailable until live provider validation.
- **Cost:** computed only from `AI_LLM_PRICE_*` / `AI_VISION_PRICE_*` when both are configured. No prices are hard-coded. **Pricing REQUIRES CURRENT PROVIDER PRICING CHECK** before it is configured.

## Alerts (all INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF)

Defined in `INITIAL_ALERT_THRESHOLDS` (`src/lib/ai/monitoring-metrics.ts`). Rate rules need at least 20 events in the window, and mock/deterministic providers are never alerted. The basis is the configured timeouts and common starting points, not live data.

| Alert | Fires when | Severity |
|---|---|---|
| `ai_error_rate` | failed `ai.call` share > 5 % (warning) / > 20 % (critical) per feature/provider/model | warning / critical |
| `ai_p95_latency` | p95 > 20 s stylist, > 12 s vision, > 12 s outfit (≈ 80 % of the 25 s / 15 s per-attempt timeouts) | warning |
| `ai_timeout_rate` | timeouts > 2 % of calls | warning |
| `ai_provider_availability` | ≥ 5 consecutive failed calls of one provider (any feature) | critical |
| `ai_provider_auth_or_config` | any `auth` or `config` error (wrong or missing key) | critical |
| `ai_quota_rejection_rate` | rejected / (charged + rejected) > 10 % per feature/provider | warning |
| `ai_outfit_fallback_rate` | outfit fallbacks (excluding quota fallbacks) > 10 % | warning |
| `ai_usage_anomaly` | tokens (else calls) > 2× or < 0.5× a baseline window with ≥ 50 calls | warning |

Suggested windows: 15 minutes for error, timeout and availability; 1 hour for p95 latency; 1 day for quota and usage. Recalibrate every threshold from the live bake-off and the first production week.

## Future backend integration

Add a sink: `setAiMonitoringSinks([logSink, prometheusSink])`. A Prometheus/OpenTelemetry sink maps:
- `ai.call` → a counter by feature/provider/model/outcome/retry, plus a latency histogram;
- `ai.request` → a counter by outcome/reason;
- `ai.quota` → a counter by action.

The alert rules above translate one-to-one into backend alert rules. Keep the whitelist sanitizer in front of every sink, and never add free-text labels: high cardinality and privacy both forbid it.
