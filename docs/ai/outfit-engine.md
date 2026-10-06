# Outfit engine (Phase 4.4)

`POST /api/v1/outfits/generate` builds outfits from the user's own wardrobe in two steps:

1. **`src/lib/ai/outfit-engine.ts`** is deterministic and pure (no I/O, no randomness, no clock). It is the only source of outfits.
2. **`src/lib/ai/outfit-intelligence.ts`** is optional. A real LLM may reorder the engine's candidates and explain the one it selects. Any problem gives the deterministic order and explanations (`fallback: true`), and the request never fails because of it.

Every constant (bands, thresholds, weights, limits) is in **`src/lib/ai/outfit-config.ts`**. `OUTFIT_ENGINE_VERSION = 'outfit-engine-v2'`.

## Pipeline

```
wardrobe (ordered by id, de-duplicated by id)
  → slot classification       category → top | bottom | dress | outerwear | footwear | accessory
  → hard filters              weather exclusions; occasion soft-exclusion (only if the slot keeps an alternative)
  → per-slot pre-rank         item rank → top SLOT_LIMITS finalists per slot
  → bounded generation        standard + dress compositions, with and without outerwear, ≤ MAX_CANDIDATES
  → composition validation    layering rules (below)
  → scoring                   weighted signals, renormalised over the available ones
  → canonical de-duplication  by the canonical key of the main pieces
  → stable sort               score, weather, occasion, colour, then the key
  → rejected compositions last (real feedback, 30 days)
  → variety pool              POOL_SIZE, an item in at most MAX_ITEM_REPEAT varied candidates
  → seed selection            no seed: best N; seed: a deterministic window of the pool
  → accessories               ranked separately; at most one accessory and one bag, each ≥ ACCESSORY_MIN_SCORE
  → optional AI rerank/explanation (validated) → deterministic fallback
```

## Compositions

| Kind | Required | Optional |
|---|---|---|
| standard | top + bottom + footwear | outerwear, accessories |
| dress | dress + footwear | outerwear, accessories |

- Footwear is always required.
- Outerwear is a layer: it is never a top, and a coat with no base top is not an outfit.
- A dress is never a top and never worn with a bottom.
- Accessories never decide which outfits are chosen.
- Layering rules:
  - no outer layer over shorts or sandals;
  - very cold: an outer layer when the wardrobe has one;
  - cold: a dress or a short-sleeved top only under an outer layer when one exists.
- The response keeps the legacy `role` (`top`/`bottom`/`shoes`/`accessory`). A dress and outerwear keep legacy role `top`, so old clients still work. The new `layeringRole` gives the real slot.

The save endpoint (`POST /api/v1/outfits`) runs `validateComposition`. It rejects:
- duplicate items;
- unknown categories;
- missing or multiple footwear;
- no main pieces;
- a dress with a top or bottom;
- more than one piece per primary slot;
- more than two accessories or more than one bag.

It also checks the role enum (`top, bottom, shoes, accessory, dress, outerwear, footwear`) and that the role matches the item's category. Score and reasons are stored as supplied, not recomputed. The weather layering rules are **not** applied on save: a combination the user chose is not a structural error.

## Weather

`weatherContext()` turns the snapshot into:

| Field | Source | Notes |
|---|---|---|
| `band` | feels-like (else temperature) | `TEMPERATURE_BANDS`: very_cold < 3 °C ≤ cold < 12 ≤ mild < 19 ≤ warm < 27 ≤ hot |
| `wet` | condition rain/thunderstorm or precipitation ≥ 60 % → likely; ≥ 30 % → possible | |
| `snow` | condition snow | |
| `wind` | ≥ 30 km/h windy, ≥ 50 km/h strong | |
| `uvHigh` | UV ≥ 6 | |
| `completeness` | share of the three groups (temperature, precipitation, wind) that are known | |

A missing field is unknown, never assumed. It removes its part of the weather signal, and `completeness` lowers the weight of the whole weather signal. No weather means no weather signal at all.

Hard exclusions:
- cold or colder: no shorts or sandals;
- hot: no outerwear with warmth ≥ 2;
- likely rain or snow: no sandals or sunglasses;
- strong wind: no hats.

## Signals and weights

Each signal is 0–100 or unavailable. The score is `Σ wᵢ·aᵢ·sᵢ / Σ wᵢ·aᵢ` over the available signals (`aᵢ` = availability). The `factors` field shows 50 for an unavailable signal (unchanged contract).

| Signal | Weight | What it measures | Availability |
|---|---|---|---|
| occasion | 0.22 | formality fit per slot (75 %) + occasion colour rules (25 %), −20 per off-occasion style | 1; 0.5 if no formality is known |
| weather | 0.22 | warmth sum vs `TARGET_WARMTH[band]` (45 %), rain readiness (shoes, protective layer, wet-sensitive materials), snow footwear, wind protection, season tags | `completeness` |
| color | 0.16 | dominant-colour pair harmony weighted by visual area (secondary colours 20 %), +5 neutral base, −12 per accent family beyond two, −5 for high contrast at work/wedding | 1 (needs ≥ 2 coloured pieces) |
| style | 0.10 | 95 same style, 82 same family, else 45–75 by compatible pairs | 1 (needs ≥ 2 known styles) |
| layering | 0.10 | whether an outer layer suits the band, rain and wind | 1; 0.5 without temperature |
| profile | 0.08 | colour profile fit near the face (top/dress/outerwear weigh most) | profile strength / 0.8 |
| preference | 0.08 | favourite/disliked colours and styles, preferred fit | 1 when preferences exist |
| feedback | 0.04 | liked/rejected items (30 days) | only with real feedback |

A composition the user rejected in the last 30 days goes below every other candidate. It is still offered if nothing else exists.

## Colour profile

`profileContext()` uses the stored profile, never a guess:
- **Strength** is `confidence`, or 0.3 for legacy profiles without stored confidence. Below 0.25 → no influence.
- **Season palettes** (recommended / neutral / caution) count only when `season` is set.
- **Secondary-season palette** counts when `secondaryConfidence` ≥ 0.2.
- **Undertone** counts only when `undertoneConfidence` ≥ 0.4, as ±10 for colours of the same/opposite temperature.
- A null season with an unreliable undertone gives no influence.

## Determinism and the seed

- Input is de-duplicated and sorted by id, and the route reads the wardrobe `orderBy: { id: 'asc' }`. Every sort has a final tie-break on the canonical key.
- **Canonical key:** `t:<id>|b:<id>|d:<id>|o:<id>|f:<id>|a:<sorted ids>` (`-` for an empty slot). `tempId` is `o_` + the first 20 hex characters of its SHA-256.
- **No seed:** the best `topN` (1–5, default 3).
- **With a seed:** the pool is split into windows of `topN`. FNV-1a(seed) chooses one window, which is filled from the start of the pool if it is short. The same wardrobe, context and seed always give the same result; a different seed may choose another window. The stylist calls the engine without a seed (canonical best).

## Bounded generation

`SLOT_LIMITS` finalists per slot: top 12, bottom 10, dress 8, outerwear 4, footwear 6. That allows at most 12·10·6·5 + 8·6·5 = 3840 compositions, and generation also stops at `MAX_CANDIDATES = 5000`. The test wardrobe (100 tops, 100 bottoms, 30 shoes, 25 outerwear, 20 dresses, 25 accessories/bags) evaluates 3840 compositions in about 0.1 s.

## AI rerank and explanation

- **Calls:** only for a real provider (the mock is never called and never charged).
- **Quota:** one `outfit_explanation` unit per request (daily limit 30, Uzbekistan day, `AiUsage`).
  - Limit reached or quota store error → deterministic fallback, never 429.
  - Provider error, timeout or invalid output → the unit is refunded.
- **What the model sees:** candidates as `O1…On`, with attributes only (slot, category, subcategory, colours, pattern, material, style, formality, sleeves); the weather band; the occasion; and season + undertone of a confident profile. It never sees ids, images, notes, brands or location.
- **Output (strict JSON schema):** `{selectedCandidate, ranking, explanation, needsMoreInfo}`. The validator requires:
  - known references only;
  - a complete ranking without duplicates;
  - `selectedCandidate` first in the ranking;
  - an explanation of 1–600 characters with no references or ids;
  - no extra fields.
- **Correction:** one attempt with the reason. Then the deterministic fallback.
- **Budget:** 25 s total, 15 s per call.
- **Result:**
  - On success: the AI order. The selected outfit gets the AI explanation; the others get deterministic explanations.
  - **Deterministic explanation:** built from the outfit's own item names and the known context (band, rain/snow/wind, occasion, colour profile, harmony). It never mentions a store, product or anything not in the outfit.
- **Logs:** `ai.call` telemetry and `ai.outfit.fallback` with a reason code only. They never contain prompts, explanations, ids or wardrobe data.

## Response fields (additive)

| Field | Meaning |
|---|---|
| `fallback` | true when the AI step was not used (mock, quota, failure) or nothing could be generated |
| `outfits[].reasons` | stable internal codes (`weather`, `warm_layers`, `rain_ready`, `snow_ready`, `wind_ready`, `occasion`, `color_harmony`, `neutral_balance`, `color_profile`, `style_match`, `preference`) |
| `outfits[].reasonLabels` | Uzbek labels for `reasons`, same order. The web and mobile apps show these and save them as the outfit's reasons. |
| `outfits[].items[].layeringRole` | top, bottom, dress, outerwear, footwear or accessory |
| `outfits[].explanation` | always set (AI or deterministic) |
| `message` | why there are no outfits: empty wardrobe, no footwear, no main pieces, nothing suitable |

`factors`, `role`, `score`, `contrastLevel` and the routes are unchanged. There is no database migration.

## Known limits

- The occasions stay the six existing ones (work, wedding, date, travel, casual, other).
- Warmth and formality come from category/subcategory/material tables, not from the garment photo.
- The AI explanation quality in Uzbek needs a live evaluation with a real provider (not run in CI; CI never uses paid keys).

## Phase 4.5 changes

- **Catalog-only context.** The outfit-AI context sends stored attributes only as catalog ids. A free-text value in a legacy or tampered row becomes `null` (or is dropped from the colours) and never reaches the prompt (`tests/regression/ai-prompt-injection.test.ts`).
- **Uzbek occasion phrases.** The deterministic explanation names the occasion in Uzbek ("ishga", "to‘yga", "uchrashuvga", "sayohatga", "kundalik kiyinishga") instead of quoting the UI label (which is "Casual" for `casual`).
- **Shared builders.** The request and correction messages are built by `outfitMessages` and `outfitCorrectionMessages`, which the evaluation harness (`scripts/ai-eval/outfit-eval.ts`) also uses.
- **Live ranking quality:** NOT TESTED; see [`provider-evaluation.md`](provider-evaluation.md).
