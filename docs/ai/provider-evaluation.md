# AI provider evaluation and bake-off (Phase 4.5; vision live section and repeated runs PHASE 5.0)

> **NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED.**
> No Gemini or OpenAI credentials were available, so no live provider was called and **no live result in this document is measured.** No provider, model or production default was changed.

Related: [`privacy.md`](privacy.md), [`production-readiness.md`](production-readiness.md), [`provider-architecture.md`](provider-architecture.md), [`vision-evaluation.md`](vision-evaluation.md), [`stylist-evaluation.md`](stylist-evaluation.md), [`outfit-engine.md`](outfit-engine.md), [`color-profile.md`](color-profile.md).

## Evaluation methodology

What was tested, and how:

| Level | What | Status |
|---|---|---|
| Live providers | stylist, outfit AI and vision against the Gemini/OpenAI APIs | **NOT TESTED** (no credentials) |
| Adapters, offline | request/response mapping, failure classification, retry, both providers, scripted HTTP | **TESTED** |
| Feature policy, offline | each failure → stylist/vision AI_UNAVAILABLE, outfit deterministic fallback, quota refunds | **TESTED** |
| Harness self-test | stylist/outfit cases through the production path with a scripted provider | **TESTED** (harness only, not provider quality) |
| Adversarial robustness | scripted misbehaving providers: invalid references, malformed output, invented candidates, failures | **TESTED** |
| Prompt injection (request level) | what leaves the server for user, stored, weather and occasion injection | **TESTED** |
| Vision dataset | synthetic labelled images, validated by the Phase 4.1 harness (`--dry-run`) | **TESTED** (dataset only) |

Principles:

- **The production path:** the harness uses the production prompt, context builder, schema, validator and correction:
  - stylist: `buildStylistContext` → `stylistMessages` → `interpretStylistOutput` → `stylistCorrectionMessages`;
  - outfit AI: `outfitMessages` → `interpretOutfitOutput` → `outfitCorrectionMessages`;
  - vision: `prepareVisionImage` → garment schema → `interpretGarmentOutput`.

  The retry policy is the same; quota and database are left out.
- **Configured models only:** `--provider`/`--model`, `AI_EVAL_GEMINI_MODEL`/`AI_EVAL_OPENAI_MODEL`, or `AI_LLM_PROVIDER`/`AI_LLM_MODEL`. There is no built-in model.
- **Synthetic data only;** results are written outside the repository (the scripts refuse a path inside it).
- **Machine-readable output** with a `status` field: `TESTED`, `PARTIALLY_TESTED` (provider level, PHASE 5.0), `NOT_TESTED` or `OFFLINE_SELF_TEST`. Offline runs report no latency.

### Harness (`apps/web/scripts/ai-eval/`)

| File | Purpose |
|---|---|
| `bakeoff.ts` | One deterministic `bakeoff.json`: live vision, stylist and outfit sections per provider (or `NOT_TESTED` with the reason and null metrics), optional repeated runs, offline self-tests, robustness, vision dataset, recommendation |
| `stylist-eval.ts` / `stylist-cases.ts` / `stylist-scoring.ts` | 17 stylist cases and their scoring |
| `outfit-eval.ts` / `outfit-cases.ts` / `outfit-scoring.ts` | 11 outfit cases and their scoring |
| `robustness.ts` | 13 adversarial scenarios with expected outcomes |
| `synthetic-vision.ts` | 15 labelled synthetic images for `vision-eval.ts` (Phase 4.1) |
| `timings.ts` | local latency of everything around a provider call |
| `eval-common.ts` | statistics, Uzbek proxy check, garment-mention grounding, provider from the environment |

```bash
cd apps/web
bun scripts/ai-eval/bakeoff.ts --out=/tmp/atlas-eval            # offline now; live sections run when keys + models are set
bun scripts/ai-eval/synthetic-vision.ts --out=/tmp/atlas-eval/vision-ds
bun scripts/ai-eval/bakeoff.ts --out=/tmp/atlas-eval --vision-dataset=/tmp/atlas-eval/vision-ds --runs=3   # PHASE 5.0
GEMINI_API_KEY=… OPENAI_API_KEY=… bun scripts/ai-eval/vision-eval.ts --dataset=/tmp/atlas-eval/vision-ds --matrix=<matrix with the configured models> --out=/tmp/atlas-eval/vision
bun scripts/ai-eval/timings.ts --n=30
```

With credentials, run each live text evaluation three times (product temperatures 0.7 and 0.3) and report the spread.

### Bake-off vision and repeated runs (PHASE 5.0)

Live vision section, one per provider. It runs the app's vision pipeline (`evaluateVisionConfig` from `vision-eval.ts`) with the app's default image settings: 1024 px; Gemini `high` resolution and `low` thinking; OpenAI `high` detail. It needs all three of:

| Needs | Variable / option | Missing → `NOT_TESTED` reason |
|---|---|---|
| key | `GEMINI_API_KEY` / `OPENAI_API_KEY` | `no <KEY> in the environment` |
| vision model (no default) | `AI_EVAL_GEMINI_VISION_MODEL` / `AI_EVAL_OPENAI_VISION_MODEL`, else `AI_VISION_MODEL` when `AI_VISION_PROVIDER` names that provider | `no configured vision model (…)` |
| labelled dataset | `--vision-dataset=<dir>` (`labels.json` + photos; optional `version`, e.g. `synthetic-v1`) | `no labelled vision dataset (--vision-dataset)` |

Fields of a `TESTED` vision section:
- `model`, `datasetVersion`, `cases`;
- `passed` / `failed` (subject correct);
- `schemaValidity` (1 − invalid − provider errors);
- `subjectAccuracy`, `falseRejectionRate`, `falseAcceptanceRate`, `categoryAccuracy`, `primaryColorAccuracy`;
- `invalidRate`, `errorRate`, `failures`, `timeouts`;
- `latencyP50` / `latencyP95` / `latencyMax`;
- mean tokens.

A `NOT_TESTED` section keeps every metric `null`: **nothing is estimated**.

Provider status:
- `TESTED` only when vision, stylist and outfit were all measured.
- `PARTIALLY_TESTED` when some were; `reason` lists what is missing.
- `NOT_TESTED` when none were.

The recommendation stays `NO FINAL PROVIDER SELECTED` unless both providers are `TESTED`. Even then it only points to the gates below; it never selects a provider.

`--runs=N` (1–10, default 1):
- Repeats the live sections. `runs[]` keeps every run, numbered `run: 1..N`; no run is hidden.
- `aggregate[]` gives, per provider, feature and numeric metric, `n`, `mean`, `min`, `max` and `spread` (max − min) over the runs where that section was `TESTED`. `NOT_TESTED` runs are never averaged in.
- The top-level `live` is run 1, so the default output (`--runs` absent) has the same shape as before.
- Offline sections are deterministic and computed once.

Tests (no credentials; scripted providers and a fake key value): `tests/unit/ai/bakeoff-vision.test.ts`.

### Dataset

| Feature | Cases |
|---|---|
| Vision (15 images) | t-shirt ×2, shirt, jacket, coat, trousers, jeans, dress, shoes, accessory; ambiguous shape; multiple garments; non-garment; poor quality (pixelated, blurred) |
| Stylist (17) | casual, work, wedding, date, travel, rain + cold, no weather, colour profile, wardrobe-limited, no suitable item, nonexistent item, empty wardrobe, and injection through the user message (×3), tampered wardrobe values, weather/occasion text |
| Outfit (11) | hot, cold, rain, snow, wind, no weather, strong / weak / no colour profile, small (4) and large (185 items) wardrobe |
| Robustness (13) | stylist: invalid references (corrected / twice / text-only), malformed JSON, extra field, provider failure; outfit: valid, invented candidate (corrected / twice), incomplete ranking, references in the explanation, malformed JSON, provider failure |

The drawn garment images test the contract and the rejection policy. They are **not** evidence of accuracy on real photos. The poor-quality images are labelled `unclear`, which encodes a policy (prefer "take another photo" over a guess).

### Rubric

| Feature | Measures |
|---|---|
| Vision (`vision-scoring.ts`) | subject accuracy (strict) and subject acceptance (with rubric-listed abstentions, v2), false rejection/acceptance, invalid-output rate, accuracy per labelled attribute, colour conflicts, raw-confidence calibration table, latency, tokens, cost |
| Stylist (`stylist-scoring.ts`) | schema validity (first and after the correction), invalid references, own references only, grounding / hallucination, private leak, Uzbek (automatic proxy plus the catalog-wording policy, v3: [`uzbek-output-policy.md`](uzbek-output-policy.md)), relevance (keyword proxy; premise correction for false-premise cases, v2), cross-user safety (v2), reference count, `needsMoreInfo`, weather claims without weather, injection (answer and request) |
| Outfit (`outfit-scoring.ts`) | schema validity, fallback rate, grounding, explanation grounding, unsupported weather/profile claims, weather suitability, colour-profile usage, top-1 agreement and Kendall tau with the engine (reported, not pass/fail), Uzbek proxy and catalog-wording policy (v3) |
| Uzbek (manual) | two native speakers, blind to the provider, 1–5 on grammar, naturalness, cultural fit, usefulness and instruction adherence; report inter-rater agreement |

## Live provider status

| Provider | Vision | Stylist | Outfit AI | Reason |
|---|---|---|---|---|
| Gemini | NOT TESTED | NOT TESTED | NOT TESTED | no credentials (`GEMINI_API_KEY` absent); PHASE 5.0: still none |
| OpenAI | NOT TESTED | NOT TESTED | NOT TESTED | no credentials (`OPENAI_API_KEY` absent); PHASE 5.0: still none |

`bakeoff.json` records both providers as `"status": "NOT_TESTED"` with every metric `null`.

## Offline results (scripted / synthetic — NOT provider results)

| Run | Status | Cases | Passed | Schema validity | Grounding | Notes |
|---|---|---|---|---|---|---|
| Stylist self-test | OFFLINE_SELF_TEST | 17 | 10 | 1.0 | 1.0 | Injection resistance 1.0 (answers and requests). The fixed scripted answer fails relevance on 7 cases by design: the rubric is not trivially satisfied. |
| Outfit self-test | OFFLINE_SELF_TEST | 11 | 11 | 1.0 | 1.0 | Scripted = engine order (tau 1.0) |
| Robustness | OFFLINE_SELF_TEST | 13 | 13 | — | — | Every adversarial scenario ends as specified, never more than 2 calls |
| Vision dataset | OFFLINE_DATASET_ONLY | 15 | — | — | — | 10 single garments, 1 multiple, 1 non-garment, 3 unclear; valid for the harness |

`bakeoff.json` is byte-identical across runs.

### Local latency (4 vCPU Xeon 2.1 GHz, n = 30, ms)

| Step | p50 | p95 |
|---|---|---|
| Vision image preparation (3000×4000 JPEG → 1024, metadata stripped) | 24.9 | 28.0 |
| Mock vision analysis (deterministic) | 11.9 | 14.6 |
| Colour analysis of a synthetic selfie (deterministic) | 34.5 | 57.0 |
| Outfit engine, 18 items | 1.8 | 4.2 |
| Outfit engine, 185 items | 46.5 | 72.5 |
| Prompt construction (stylist 16 items / outfit) | 0.06 / 0.02 | 0.26 / 0.19 |
| Output validation (vision / stylist / outfit) | ≤ 0.02 | ≤ 0.16 |
| Mock provider | ≈ 0 | ≈ 0 |

Local work is far below the provider timeouts, so **provider latency will dominate. Live latency is NOT TESTED.**

### Structured-output compatibility (documentation check, not live)

All three schemas (garment, stylist, outfit) use `type`, `properties`, `required`, `additionalProperties: false`, `enum`, `anyOf`, `items`, `minItems`, `maxItems`, `minimum`, `maximum` and `description`. Every object lists all its properties as required, which OpenAI strict mode needs.

- **OpenAI** documents all of these as supported in strict mode.
- **Gemini** documents `enum`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`, `required` and `additionalProperties`, and shows `anyOf` and nullable types in its examples.

Live acceptance is **NOT TESTED**.

## Security

- **Test isolation:** tests can never call a live provider.
  - `tests/setup.ts` applies `tests/ai-test-env.ts`: the mock is pinned, keys and models are removed, and a fetch guard refuses `generativelanguage.googleapis.com` and `api.openai.com`.
  - The integration config pins the same environment; e2e and spawned servers set the mock explicitly.
  - `test-isolation.test.ts` proves a hostile shell (real provider names, models and keys) is neutralised, and that a real adapter without an injected fetch cannot reach the network.
- **Prompt injection** (`tests/regression/ai-prompt-injection.test.ts`, 7 tests):
  - user text stays in the user turn;
  - the rules stay first and fixed;
  - free text in every wardrobe attribute column (wardrobe items have no name, notes or brand columns), in the weather condition or in the event never reaches the rules or the context;
  - no database, user, conversation or image ids reach the model;
  - invented items or candidates are corrected once, then refused (stylist) or replaced by the fallback (outfit);
  - logs stay content-free.

  Phase 4.5 fixed the outfit-AI context, which previously forwarded stored values unfiltered.
- **Failure matrix** (`tests/regression/ai-failure-matrix.test.ts`, 79 tests): see [`production-readiness.md`](production-readiness.md#failure-matrix).

## Privacy

See [`privacy.md`](privacy.md) for exactly what each provider receives. In short:
- **Vision:** only the re-encoded, metadata-free image.
- **Stylist:** catalog-only wardrobe attributes with W references, weather without location, preferences, the colour-profile summary, history and the user's own text.
- **Outfit AI:** O references with catalog-only attributes and derived weather.
- **Colour profile:** never sent.

The official provider terms (Gemini paid vs free tier, OpenAI retention and controls) are summarised there; legal questions are marked **REQUIRES LEGAL REVIEW**.

## Confidence

**REAL-WORLD CALIBRATION REQUIRED.** Without labelled real data no threshold was changed.

| Area | Current behaviour (verified on synthetic fixtures) | Status |
|---|---|---|
| Clothing, real providers | shown confidence ≤ 0.69 (`UNCALIBRATED_MAX_CONFIDENCE`); a pixel colour conflict lowers colour further; raw values stored for calibration | kept; needs real data |
| Clothing, mock (dev/demo only) | colour 0.86–0.94 and pattern up to 0.78, above the 0.69 cap. Unchanged since Phase 1, labelled `mock: true`, refused in production without explicit acknowledgement. | observation, not changed |
| Colour profile | caps 0.8 overall / 0.45 without undertone / 0.65 without contrast; ambiguous evidence → season `null`; unknown undertone → `unknown` | kept; **real-world validation REQUIRED BEFORE PRODUCTION LAUNCH** |
| Outfit engine | profile ignored below 0.25; undertone only from 0.4 | kept |
| Stylist output | strict schema + reference validation; the correction only for ungrounded references | verified offline (robustness) |

### Colour profile, real-world validation

**REQUIRED BEFORE PRODUCTION LAUNCH.** No consented real-selfie set exists; none was invented, scraped or downloaded. Known limitations, tested only synthetically:
- lighting and white balance (no colour reference in the photo);
- the full range of skin tones, especially deep skin in dim light;
- dark hair against dark backgrounds;
- glasses and sunglasses;
- face position;
- low-resolution front cameras.

No medical or biometric accuracy is claimed. See [`color-profile.md`](color-profile.md#limitations).

## Cost

Only verified information:
- **Request text sizes measured on the synthetic cases** (characters of prompt + context + user turn + schema):

  | Path | Characters |
  |---|---|
  | Stylist | p50 6,706 (worst case with 40 items and a 2,000-character message: 13,679, plus up to 12 history messages) |
  | Outfit AI | p50 4,681 |
  | Vision | 5,019 plus the image |

  Token counts depend on each provider's tokenizer: **NOT TESTED.**
- **Output caps:** stylist 600 tokens, outfit 400, vision 1,024.
- **Daily upper bound per user** (the quotas): stylist 50, vision 50, outfit 30.
- **Pricing: REQUIRES CURRENT PROVIDER PRICING CHECK** for the configured model. No price is recorded here or hardcoded. `AI_*_PRICE_*_USD_PER_MTOK` turns measured usage into a cost in telemetry once prices are confirmed.
- **Expensive paths:**
  - vision (image tokens, largest output cap, heavy during wardrobe set-up);
  - stylist (largest context, history grows per turn);
  - outfit AI (small, but runs on every generation up to its limit).
- No quota change: there is no evidence that one is needed.

## Recommendation

**NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED.**

| Criterion | Gemini | OpenAI | Evidence level |
|---|---|---|---|
| Adapter correctness, failure handling, retry | equal | equal | **tested** (offline, scripted HTTP) |
| Structured-output schema compatibility | compatible on paper | compatible on paper | **partially tested** (documentation, not live) |
| Data handling | paid tier: no training, 55-day abuse logs; free tier **unacceptable** | no training by default, ≤ 30-day abuse logs, ZDR by approval; `store: false` sent | **partially tested** (official terms; legal review open) |
| Accuracy, grounding, Uzbek, latency, failure rate, cost | — | — | **not tested** |

Next steps:
1. Set keys and models in a non-production environment.
2. Run `bakeoff.ts --runs=3 --vision-dataset=<real labelled photos>` (PHASE 5.0), and `vision-eval.ts` for a setting sweep.
3. Add native-speaker Uzbek scores.
4. Choose the provider that meets every gate with the best Uzbek score; use cost and latency only as tie-breakers.

Suggested gates (team to confirm):

| Feature | Gates |
|---|---|
| Vision | schema validity ≥ 98 %; non-garment false acceptance ≤ 5 %; category accuracy ≥ 90 % on real photos |
| Stylist | final validity ≥ 98 %; hallucination ≤ 2 %; injection resistance 100 %; native Uzbek ≥ 4/5 |
| Outfit AI | fallback ≤ 5 %; explanation grounding ≥ 98 % |
| All | p95 within the configured budgets; timeout rate ≤ 2 % |

## Production blockers

1. **Live bake-off not run** (Gemini and OpenAI NOT TESTED): quality, Uzbek, latency, failure rates and token usage are unknown.
2. **Vision accuracy on real, labelled garment photos** not measured.
3. **Colour-profile real-world validation** not done (consented, diverse selfie set): REQUIRED BEFORE PRODUCTION LAUNCH.
4. **Legal review** of provider terms not done: paid Gemini tier or OpenAI controls, DPA, retention, region, user notice ([`privacy.md`](privacy.md)).
5. **Current pricing** for the chosen model not confirmed; no cost estimate.
6. **Monitoring in production:** the events, the log-based dashboard and the provisional alerts exist ([`monitoring.md`](monitoring.md)). A log collector or metrics backend must still be wired up in production, and the thresholds must be calibrated after the live bake-off.
