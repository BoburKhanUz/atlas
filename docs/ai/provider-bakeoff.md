# Live provider bake-off (PHASE 5.1)

> **NO FINAL PROVIDER SELECTED.**
> - The bake-off collects evidence. Choosing a provider is a separate, approval-gated step.
> - The harness never changes `AI_LLM_PROVIDER` or `AI_VISION_PROVIDER`, never enables AI in production, and has no automatic fallback between providers.

Related:
- [`provider-evaluation.md`](provider-evaluation.md): Phase 4.5 methodology and gates (historical results kept);
- [`vision-evaluation.md`](vision-evaluation.md);
- [`privacy.md`](privacy.md);
- [`monitoring.md`](monitoring.md);
- [`rollout.md`](rollout.md).

## Status of the Phase 5.1 run

| Item | Value |
|---|---|
| Date and time of the run | 2026-10-07T05:51:59Z (UTC), final gate run |
| Gemini | **NOT_TESTED**: no `GEMINI_API_KEY` in the environment |
| OpenAI | **NOT_TESTED**: no `OPENAI_API_KEY` in the environment |
| Models | none configured (`AI_EVAL_*_MODEL`, `AI_EVAL_*_VISION_MODEL`, `AI_LLM_MODEL` and `AI_VISION_MODEL` all absent) |
| Runs | 3 (`--runs=3`) |
| Provider calls made | **0** (upper bound 0: nothing could run live; budget used 0; dataset integrity OK) |
| CLI exit | 0: a controlled `NOT_TESTED`, not a crash. With a key and model but no `--max-calls`, the CLI exits 1 before any call. |
| Result location | outside the repository: the run's scratch directory (`bakeoff.json`, `bakeoff.md`, and `raw-outputs.json` for synthetic cases); nothing is committed |

No live result exists, and none was estimated or substituted with the mock. The offline checks ran:
- adversarial robustness suite: 13/13 scenarios as specified;
- stylist harness self-test: injection resistance 1.0;
- outfit harness self-test: 11/11.

These are harness checks, **not provider results**.

## Objective

Collect comparable, repeatable evidence for Gemini and OpenAI on the three implemented capabilities:

| Capability | Live path (the app's code) |
|---|---|
| Vision / clothing analysis | `prepareVisionImage` → garment schema → `interpretGarmentOutput` → colour cross-check; the app's retry policy (one retry, transient errors only) |
| Stylist | engine candidates → `buildStylistContext` → `stylistMessages` → provider → `interpretStylistOutput` → at most one correction → reference resolution |
| Outfit AI (rerank and explanation) | deterministic engine → `outfitMessages` → provider → `interpretOutfitOutput` → at most one correction, else the deterministic result |

The deterministic outfit engine stays the source of truth. The AI only reorders candidates and explains them; it cannot add items or change scores.

## Environment

Credential variables (names only; never written to files, logs or reports):

| Purpose | Variables |
|---|---|
| Keys | `GEMINI_API_KEY`, `OPENAI_API_KEY` |
| Text model per provider | `AI_EVAL_GEMINI_MODEL`, `AI_EVAL_OPENAI_MODEL`; else `AI_LLM_MODEL` when `AI_LLM_PROVIDER` names that provider |
| Vision model per provider | `AI_EVAL_GEMINI_VISION_MODEL`, `AI_EVAL_OPENAI_VISION_MODEL`; else `AI_VISION_MODEL` when `AI_VISION_PROVIDER` names that provider |
| Prices (optional, for cost) | `AI_LLM_PRICE_INPUT_USD_PER_MTOK` / `AI_LLM_PRICE_OUTPUT_USD_PER_MTOK` and `AI_VISION_PRICE_*`. These are the app's own variables and apply only to the provider that `AI_LLM_PROVIDER` / `AI_VISION_PROVIDER` names. |
| Call cap (**required for any live call**) | `--max-calls=N` or `AI_EVAL_MAX_CALLS` |
| Cost cap (optional) | `--max-cost-usd=X` or `AI_EVAL_MAX_COST_USD`; needs a configured price for every live section |
| Sections (optional) | `--section=vision`, `stylist` or `outfit`, or a comma-separated combination; default: all three |

- There is no built-in model.
- A section without a key, a model or a dataset is `NOT_TESTED`, with the reason and `null` metrics.
- Use staging-only keys with a spending limit set at the provider.

## Datasets (frozen)

| Capability | Dataset | Version | sha256 | Cases | Kind |
|---|---|---|---|---|---|
| Vision | `synthetic-vision.ts` output (`labels.json` + PNGs) | `synthetic-v2` | `9e023ad226c05db4e0e9c27d21d8f8b6861e00f7ae9798f5dd768d3ded922e73` | 15: 10 garments, multiple garments, 2 no garment, 2 unclear | **synthetic** |
| Stylist | `stylist-cases.ts` | `synthetic-v1` | `8733e67cf7fdbde2109006f3e476a792c115364bd0fc798220253dba83416c54` | 17 (occasion, weather, grounding, limited wardrobe, 5 prompt-injection) | **synthetic** |
| Outfit | `outfit-cases.ts` | `synthetic-v1` | `7a16530b7e1adccd8fc9f8280a84ef0cc11ee9342b704aec20b546bf76e27076` | 11 (weather, colour profile, wardrobe size) | **synthetic** |

- Vision `synthetic-v2` (2026-10-07) relabels `ambiguous_blob` from `unclear` to `no_garment`: the vision prompt keeps `unclear` for dark, blurred or cropped photos, and a sharp image of non-clothing shapes is `no_garment`. The images are unchanged; v1 (`e82f761b…`) results are not comparable on that case.
- The hash covers the frozen content. For vision that is `labels.json` plus every image's bytes; for text it is the case definitions. `bakeoff.json` → `datasets` records the path, version, sha256, case count and kind.
- **Integrity:**
  - Every image is re-hashed right before it is sent.
  - Every dataset is re-hashed before each section and after the last run.
  - A change stops every later provider call: the image is never sent, the remaining sections and runs read `DATASET_INTEGRITY_FAILURE`, and `execution.integrity.status` says so.
- A vision set may declare `"kind": "real"` in `labels.json`. Only such a set can support real-world quality claims.

Real-world status:

| Data | Status |
|---|---|
| Real labelled clothing photos | **BLOCKED — dataset unavailable** |
| Consented selfie set (colour profile) | **BLOCKED — dataset unavailable** |
| Human-rated Uzbek | **NOT_EVALUATED** (no native raters). `uzbekRate` is an automatic proxy and is not a quality score. |

Synthetic results show that the pipeline works. They are **not** real-world quality.

## Running it

```bash
cd apps/web
OUT=/path/outside/the/repo/bakeoff-$(date -u +%Y%m%dT%H%M%SZ)
bun scripts/ai-eval/synthetic-vision.ts --out=$OUT/vision-ds          # or a real labelled set
GEMINI_API_KEY=… OPENAI_API_KEY=… \
AI_EVAL_GEMINI_MODEL=… AI_EVAL_OPENAI_MODEL=… AI_EVAL_GEMINI_VISION_MODEL=… AI_EVAL_OPENAI_VISION_MODEL=… \
  bun scripts/ai-eval/bakeoff.ts --out=$OUT --vision-dataset=$OUT/vision-ds --runs=3 --max-calls=900 [--max-cost-usd=…]
```

- The output directory must be outside the repository; the script refuses a path inside it.
- `raw-outputs.json` (written next to the report when a live section ran) keeps, per run and case, the parsed model output and the checks it was scored with: vision outcome and labels, stylist answer and the text shown to the user, outfit ranking and explanation. It exists for failure analysis. Only synthetic cases are kept; a real dataset's outputs are never collected. It holds no keys, prompts or request bodies.
- When anything can run live, the CLI refuses to start without `--max-calls`. This is checked before any provider is built.
- Without credentials the CLI exits 0 and reports `NOT_TESTED` with the reason. This is a controlled result, not a crash.
- `--runs` defaults to 3 when a live text section can run, otherwise 1.
- `--section` limits the live sections, for example a stylist-only smoke run with the smallest allowed cap (17 cases × 4 calls):

  ```bash
  bun scripts/ai-eval/bakeoff.ts --out=$OUT --section=stylist --runs=1 --max-calls=68
  ```

  Unselected sections are planned at zero calls and reported `NOT_TESTED (not selected (--section))`; `--vision-dataset` does not start vision unless `vision` is selected. Every other control is unchanged: the call cap is checked against the selected sections, and the shared budget, circuit breaker, dataset integrity and accounting work as before. `execution.sections` records the selection. An unknown, empty or repeated value is refused before any provider is built.
- The harness is never run with real keys in CI. The unit tests use scripted providers and a fake key value.

## Methodology

- **Independent sections:** each provider × capability × run is a separate section with its own counters and circuit breaker. One provider failing never affects the other.
- **Runs:** every run is kept in `runs[]`, numbered 1..N. The top-level `live` is run 1.
- **Order:** cases run in their frozen order, one at a time, with no concurrency.
- **Temperatures:** the product's own: stylist 0.7, outfit 0.3.

## Metric definitions

Every section (provider × capability × run) has its own `accounting` entry.

| Term | Definition |
|---|---|
| attempt | one real provider API call: the initial call, a retry or a correction. A failed or timed-out call is still an attempt. |
| request | one logical request: the image for vision; for text, the first request plus the correction when there is one |
| retry | an attempt that follows a retryable failure of the same request. It is counted when it happens. For requests that reached the provider, `attempts = requests + retries`. |
| correction | the single correction request after an invalid first answer: stylist on an invalid reference, outfit on any invalid output. It is a request, not a retry. |
| attempted case | a case that reached the provider at least once |
| `successRate` | successful cases ÷ attempted cases |
| `failureRate` | (invalid-output cases + provider-error cases) ÷ attempted cases |
| `timeoutRate` | timed-out attempts ÷ attempts |
| circuit break | `CIRCUIT_BREAK`: a case refused locally because the section's circuit is open. It is not an attempt, not a provider call and not in any denominator. |
| refused mid-case | if the circuit or budget refuses a retry or correction after the case already reached the provider, the case is an attempted `provider_error` whose kind is the refusal. The refused attempt is never counted as a call, in the ledger or in the runner's `calls`. |
| budget stop | `BUDGET_STOP`: a case refused locally because `--max-calls` or `--max-cost-usd` was reached. It is not an attempt. |
| `NOT_TESTED` | the section did not run. It has no accounting entry and is never 0, never a success and never in a denominator. A rate with a zero denominator is `null`. |
| invalid output vs provider error | the provider answered but the output broke the contract (application validation; the circuit is not affected), versus the call itself failed (`malformed_response`, `timeout`, `auth`…; it counts toward the circuit) |
| p50 / p95 / p99 | nearest-rank percentiles of the measured latencies of attempted cases. p95 needs at least 20 samples and p99 at least 100; otherwise `null`. |
| tokens | input, output and total, summed over the attempts that reported usage |
| cost | tokens × the configured price. Without a price or token counts: `COST_UNAVAILABLE`, never 0. The price source (environment variable) is recorded with `verified: false`. |

**Retry policy, one layer:** the bake-off uses the app's `withRetry`, as `client.ts` does: at most one retry, for `timeout`, `network`, `rate_limited` (when Retry-After ≤ 3 s) and `unavailable`. `auth`, `config`, `invalid_request`, `malformed_response`, `content_filtered`, `provider_error` and `cancelled` are never retried.
- Text: the runners retry; the counting wrapper does not.
- Vision: the wrapper retries; `vision-eval.ts runOne` does not.
- So there is never a double retry.

**Circuit breaker:** per section, so separate per provider, capability and run, with no state across them.
- It opens after 2 auth, config or invalid-request failures, or 5 failed attempts in a row. A success resets the streak, and a timeout counts as a failure.
- When open, the provider is not called. The case is reported as `CIRCUIT_BREAK`, with the opening error kind in `circuitOpen`.
- It is **not** a fallback: nothing switches to the other provider.

**Provider source:** `execution.providerSource` is `"real"` when the CLI's providers ran, `"none"` when nothing ran live, and `"TEST_ONLY"` when providers were injected (tests only). Every measured cell is prefixed `TEST_ONLY`, and the recommendation says `TEST_ONLY RUN … NOT A PROVIDER RESULT`. The CLI never injects providers.

## Metrics

| Capability | Quality (`features[]`) | Accounting (`accounting[]`) |
|---|---|---|
| Vision | schema validity, subject accuracy, category and primary-colour accuracy, false acceptance and rejection, invalid and error rates | requests, attempts, retries, timeouts, error kind per failed attempt, error kind per failed case, circuit state, latency p50/p95/p99/max, tokens, cost |
| Stylist | first-answer schema validity, final validity, invalid-reference rate, grounding, hallucinated-item rate, relevance, injection resistance, Uzbek proxy, provider-error rate | same |
| Outfit | schema validity, final validity, fallback rate, grounding, explanation grounding, top-1 agreement with the engine, Kendall's tau, weather and colour-profile use, Uzbek proxy | same |

Additional rules:
- **Correction behaviour:** first-answer validity versus final validity, plus `requests` (first request plus correction) versus `attempts`.
- **Failed cases are listed one by one** in `failures[]`: the synthetic case id, the names of the failed checks or the error kind, and an `injection` flag. A failure on an injection case is a safety failure and is never hidden in an aggregate.
- **Not averaged into quality:** cases that ended in a provider error are excluded from the quality rates and counted in `providerErrorRate`, `caseErrors` and `failures[]`.
- **Confidence:** calibration is **not** claimed. The synthetic labels carry no ground truth for confidence.

## Aggregation

When `--runs` > 1, `aggregate[]` reports, per provider and feature:
- `mean`, `min`, `max` and `spread` of every numeric metric, over the runs where that section was `TESTED`;
- `pooledLatencyMs` (p50, p95, p99, max) over every case of every run.

Percentiles need enough samples:
- p95 needs at least 20;
- p99 needs at least 100.

Below that they are `null`; the maximum is still shown.

## Cost and call budget

The upper bound of provider calls is computed **before any call**:

| Per case | Calls |
|---|---|
| Vision | 1 request × (1 + 1 retry) = 2 |
| Stylist | (first + correction) × (1 + 1 retry) = 4 |
| Outfit | (first + correction) × (1 + 1 retry) = 4 |

For the frozen sets, one provider and one run is 15·2 + 17·4 + 11·4 = **142 calls**. Both providers × 3 runs is **852 calls at most**. The typical number is close to 43 per provider and run: one call per case.

Controls:
- `--max-calls` refuses a plan above the cap before any provider is built. The CLI requires it for any live call.
- Each section is limited to 500 cases, and `--runs` to 10.
- At run time, a shared budget refuses attempts beyond `--max-calls`, and attempts after the estimated spend reaches `--max-cost-usd`. Such cases are reported as `BUDGET_STOP`.
- `execution.budget` reports attempts used, cost spent (or `COST_UNAVAILABLE`) and whether a limit was reached.
- **Circuit breaker:** a section stops calling its provider after 2 auth, config or invalid-request failures, or after 5 failed attempts in a row. The remaining cases fail locally as `cancelled`. A failing provider is never retried continuously, and retries stay at one per request.
- **Cost** is computed only from configured prices and reported token usage. Current pricing is **NOT VERIFIED**; without a price, cost is `N/A`.

## Privacy

- The report holds synthetic case ids, check names, error kinds, counters and latencies only:
  - no prompt, answer, image, file name or user id;
  - no database id (stylist references are opaque `W1/W2…` inside the harness);
  - no key, and no Authorization header.
- Provider errors are reduced to their kind.
- Images are re-encoded by `prepareVisionImage`, so no EXIF or GPS data reaches the provider.
- The app's content-free monitoring is unchanged. The harness writes nothing to the database and stores nothing as training data.
- Datasets and results stay outside Git.
- Provider data handling (training use, retention, ZDR, paid tier) is documented in [`privacy.md`](privacy.md) as operational evidence. **Legal review: PENDING.** No legal conclusion is drawn here.

## Interpreting failures

| Signal | Meaning |
|---|---|
| `NOT_TESTED` | missing key, model or dataset; nothing was called |
| `PARTIALLY_TESTED` | some capabilities of a provider were measured |
| `circuitOpen: "auth"` / `"config"` | credentials or model wrong; the section's quality numbers are not meaningful |
| high `timeouts` / `attemptErrors.unavailable` | provider instability or timeouts too tight; compare across runs (`spread`) |
| `failures[]` with `injection: true` | a safety failure. Injection protection must be 100 %. |
| outfit `fallbackRate` | the share of requests where users get the deterministic result (never a broken generation) |

## Provider decision policy

1. Both providers must be `TESTED` on every capability, with `--runs=3`.
2. Apply the gates in [`provider-evaluation.md`](provider-evaluation.md#recommendation), using real labelled photos and native-speaker Uzbek scores.
3. A human decides, separately for text and vision if wanted, after the legal review and a pricing check.
4. The harness output always says `providerDecision: "NO FINAL PROVIDER SELECTED"`.

## Known limitations

- No credentials were available, so nothing was measured live.
- All datasets are synthetic. Real clothing photos, consented selfies and native Uzbek raters are missing.
- Live prompt-injection evidence is limited to the stylist set's 5 injection cases. The offline adversarial suite (scripted misbehaving providers: invalid references, malformed output, invented items, failures) checks the app's handling, not model behaviour.
- Operational complexity and data controls are documented, not measured.
- The Dart client drift check has a baseline failure: an existing build_runner/analyzer incompatibility, unrelated to the bake-off.
