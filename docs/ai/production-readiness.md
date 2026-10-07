# AI production-readiness checklist (Phase 4.5)

Legend:
- **PASS:** verified in this phase, with evidence.
- **FAIL:** verified to be wrong.
- **NEEDS REVIEW:** needs a decision or review outside engineering, or the evidence is partial.
- **NOT TESTED:** needs live credentials or real data that were not available.

**Verdict: NOT READY to enable real AI in production.** Code, security and configuration pass. Live quality is not tested, and the legal review and real-world validations are open. Production stays fail-closed: it refuses to start without a complete, explicit provider configuration.

| Area | Status | Evidence |
|---|---|---|
| Provider abstraction | PASS | REST adapters with no SDKs; registry; configured model only. `adapters.test.ts`, `stylist-adapters.test.ts` |
| Gemini correction turn | PASS | fixed in 4.5: a later system message becomes an in-place user turn, so `contents` ends with the latest request. `adapters.test.ts` |
| Error mapping, timeout, retry | PASS | ≤ 1 retry, transient kinds only, Retry-After ≤ 3 s. `transport-retry.test.ts`, `ai-failure-matrix.test.ts` |
| Structured-output validation | PASS | strict schemas plus zod, catalog and reference checks. `garment-analysis.test.ts`, `stylist.test.ts`, `outfit-generate.test.ts`, robustness suite |
| Deterministic fallback | PASS | outfit → engine order and explanation; stylist/vision → typed AI_UNAVAILABLE. Failure matrix, e2e |
| Test isolation | PASS | fixed in 4.5: mock pinned, keys and models removed, provider hosts refused. `tests/ai-test-env.ts`; `test-isolation.test.ts` (hostile env, network guard) |
| Secrets | PASS | gitleaks clean; keys only from the environment, sent as headers, never logged. `config.test.ts` (no key in messages) |
| Prompt injection | PASS (request level) / NOT TESTED (live model behaviour) | `ai-prompt-injection.test.ts` (7); fixed in 4.5: outfit context is catalog-only. Live injection cases are in the stylist harness |
| Telemetry privacy | PASS | exact field whitelist (`client-telemetry.test.ts`); content-free logs (`ai-prompt-injection`, `outfit-generate`, `wardrobe-vision`, `stylist-chat` tests) |
| Image privacy | PASS | re-encoded JPEG; no EXIF, GPS, file name or URL. `wardrobe-vision.test.ts`, `vision-input.test.ts` |
| Location privacy (weather) | PASS | fixed in 4.5: coordinates rounded to 2 decimals before Open-Meteo. `weather-privacy.test.ts` |
| Vision validation | NEEDS REVIEW | contract, rejection and validation PASS offline; synthetic dataset ready; accuracy on real photos NOT TESTED |
| Stylist validation | NEEDS REVIEW | grounding and validation PASS offline (self-test, robustness); live quality NOT TESTED |
| Outfit validation | NEEDS REVIEW | engine and fallback PASS (engine tests, e2e); live AI ranking and explanation NOT TESTED |
| Color validation | NEEDS REVIEW | synthetic tests only; real-world validation REQUIRED BEFORE PRODUCTION LAUNCH |
| Confidence calibration | NEEDS REVIEW | caps verified; REAL-WORLD CALIBRATION REQUIRED |
| Gemini live test | NOT TESTED | no credentials |
| OpenAI live test | NOT TESTED | no credentials |
| Provider bake-off | NOT TESTED | no credentials; framework ready (`bakeoff.ts`) → NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED |
| Uzbek live quality | NOT TESTED | no credentials; automatic proxy and native-speaker rubric ready; fallback texts pass the proxy (fixed in 4.5: no English occasion label) |
| Privacy review | NEEDS REVIEW | engineering review done ([`privacy.md`](privacy.md)); REQUIRES LEGAL REVIEW (paid Gemini tier, DPA, retention, region, user notice) |
| Production configuration | PASS | environment-driven; fails closed (no implicit mock, key and model required, unknown provider refused); mock only with `AI_ALLOW_MOCK_IN_PRODUCTION=1`, reported as `mockInProduction`. `config.test.ts`, failure matrix (configuration rows, `assertServerConfig`) |
| Quota | PASS | real providers charged once; mock never; failures refunded; invalid requests and idempotent replays not charged. `ai-usage.itest`, STY-01, VIS-01..06, outfit itests, failure matrix |
| Quota configurability | NEEDS REVIEW | code constants (`quota.ts`); changing them needs a release |
| Cost validation | NOT TESTED | request sizes measured; tokens and current pricing REQUIRE CURRENT PROVIDER PRICING CHECK |
| Latency validation | NOT TESTED (live) / PASS (local) | local steps ≤ 73 ms p95 (`timings.ts`); provider latency needs live calls |
| Monitoring | PASS (offline) / NOT TESTED (live) | `ai.call` / `ai.request` / `ai.quota` events behind a whitelist sanitizer; log-based dashboard and provisional alerts (`scripts/ai-monitor.ts`, [`monitoring.md`](monitoring.md)); `monitoring.test.ts`, `ai-monitoring.test.ts`. A production log collector or metrics backend and live threshold calibration are still needed. |

## Failure matrix

All rows are verified offline through the real Gemini **and** OpenAI adapters (scripted HTTP) into each feature (`ai-failure-matrix.test.ts`, 79 tests). "Attempts" means provider HTTP calls for one request.

| Failure | Attempts | Stylist | Outfit AI | Vision |
|---|---|---|---|---|
| Timeout | 2 | AI_UNAVAILABLE, refunded | deterministic fallback, refunded | AI_UNAVAILABLE, refunded |
| Network error | 2 | same | same | same |
| 429 without Retry-After / with a short one | 2 | same | same | same |
| 429 with Retry-After > 3 s | 1 | same | same | same |
| Transient 5xx (500, 503) | 2 | same | same | same |
| Provider unavailable / bad key (401) | 1 | same | same | same |
| Invalid request / invalid model (400) | 1 | same | same | same |
| Malformed body (not JSON) / empty output | 1 | same | same | same |
| Invalid structured output | stylist 1, outfit 2, vision 1 | AI_UNAVAILABLE (never retried) | one correction, then fallback | AI_UNAVAILABLE (never retried) |
| Correction failure (still ungrounded) | 2 | AI_UNAVAILABLE | fallback | — |
| Transient failure, then success | 2 | answer, no refund | — | — |
| AI quota exceeded | 0 | typed quota error (429) | fallback (never 429) | typed quota error (429) |
| Missing provider configuration (production) | — | server refuses to start | same | same |
| Invalid / unknown provider | — | refuses to start (any environment) | same | same |
| Mock in development / test | — | default; no key; never charged | same | same |
| Mock in production | — | refused unless `AI_ALLOW_MOCK_IN_PRODUCTION=1`, then reported (`mockInProduction`) | same | same |
| Missing production API key | — | refuses to start (`GEMINI_API_KEY must be set …`) | same | same |
| Test + hostile live-provider env | — | neutralised: mock, no keys, provider hosts refused | same | same |

There are no hidden retries: the single retry lives in `client.ts`/`retry.ts`, and the features add only the documented single correction (stylist: ungrounded references only; outfit AI: any invalid output).
