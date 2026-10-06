# Clothing vision (Phase 4.1) and its evaluation

Status: **implemented behind configuration, not evaluated.** Gemini and OpenAI are both supported as candidates. No provider or model is selected, and the real-provider path must not be called production-ready until the bake-off below has run on a labelled dataset.

## Pipeline

`POST /api/v1/wardrobe/items` (route: `apps/web/src/app/api/v1/wardrobe/items/route.ts`, service: `apps/web/src/lib/ai/vision-service.ts`):

1. Auth, upload validation (type, size, dimensions), idempotency claim.
2. The image is stored privately (master, display, thumbnail), as before.
3. **Real provider only:** `prepareVisionImage(bytes, AI_VISION_MAX_SIDE)` rotates upright, strips all metadata (EXIF, GPS), flattens transparency onto white, re-encodes as JPEG, never enlarges, and refuses a result over 4 MB. A failure here is `INVALID_IMAGE` 422 and is not charged.
4. **Real provider only:** one `clothing_analysis` quota unit is consumed (50 per user per Uzbekistan day, atomic). At the limit: `AI_QUOTA_EXCEEDED` 429.
5. `analyzeImage` sends the prepared JPEG plus the versioned prompt and strict JSON Schema from `garment-analysis.ts` (`VISION_ANALYSIS_VERSION = "v1"`). One retry at most, for transient errors only.
6. The output is validated with Zod and against the catalog, including that the subcategory belongs to the category. Any violation rejects the whole output; nothing is salvaged.
7. The model's primary colour is cross-checked against the pixels (`color-check.ts`).
8. The item, its presented confidences and its analysis metadata are stored in one transaction, the idempotency key is completed, and the existing 201 response is returned.

The file name is never sent to a provider (it only feeds the development mock), and no storage URL is ever sent: providers receive the prepared bytes only.

With `AI_VISION_PROVIDER=mock` (development, e2e, local Docker) steps 3–7 are replaced by the previous deterministic mock, no quota is used and `detection.mock` is `true`.

## Outcomes

| Outcome | HTTP | Quota | Stored files / idempotency key |
|---|---|---|---|
| Success | 201 | charged | kept / completed |
| Idempotent replay | 201 (`Idempotent-Replayed: true`) | not charged, no re-analysis | — |
| Upload invalid (type, size, dimensions) | 422 `INVALID_IMAGE` etc. | never reaches quota | — |
| Preparation failed | 422 `INVALID_IMAGE` | not charged | deleted / released |
| Daily limit reached | 429 `AI_QUOTA_EXCEEDED`, `Retry-After` = seconds to the next Tashkent midnight | — | deleted / released |
| `subject` is `multiple_garments`, `no_garment` or `unclear` | 422 `NOT_A_GARMENT` (details: `subject`) | charged (the provider did the work) | deleted / released |
| Provider safety refusal (`content_filtered`) | 422 `INVALID_IMAGE` | charged | deleted / released |
| Timeout, network, 429/5xx after the retry, auth, config, malformed or invalid output | 503 `AI_UNAVAILABLE`, `Retry-After: 15` | refunded | deleted / released |

A released key can be reused: the mobile app retries `AI_UNAVAILABLE` with the same key.

## Confidence

- Raw model confidences are stored unchanged in `WardrobeItem.analysisRawConfidences` (JSON).
- **They are not calibrated.** Until a calibration table exists, the confidences presented to clients (`WardrobeItem.confidences`, `detection.confidences`) are capped at `UNCALIBRATED_MAX_CONFIDENCE = 0.69`, just below the clients' 0.70 "high" band, so no real-provider attribute is shown as high confidence.
- Colour cross-check (`color-check.ts`; every threshold is a named constant there):
  - The centre 60 % of the prepared image is sampled at 48×48 and each pixel is mapped to the nearest catalog colour.
  - Support = share of pixels in the primary colour's family (`COLOR_FAMILIES`).
  - ≥ 0.15: supported (no change). 0.05–0.15: weak, colour confidence capped at 0.60. < 0.05: conflict, capped at 0.35 (below the 0.40 "low" band, so the user is asked to review).
  - Pixels never add, remove or replace colours. If the check itself fails, the weak cap is applied.

These thresholds are first guesses and must be tuned with the harness below.

## Stored metadata

Migration `20261008000000_wardrobe_analysis_metadata` adds nullable `analysisProvider`, `analysisModel`, `analysisVersion`, `analyzedAt` and `analysisRawConfidences` to `WardrobeItem`, and labels every existing row explicitly as the mock (`mock` / `mock-vision` / `pre-4.1`, `analyzedAt = createdAt`). `detection.mock` is derived from `analysisProvider` (`mock` or null → true).

Rollback: `docs/database/rollback/down-wardrobe-analysis-metadata.sql`, run before `down-ai-usage.sql` (see `docs/database/cutover.md`). It drops only the five columns; items and their attributes stay.

## Privacy

- Providers receive the prepared JPEG (no EXIF/GPS, no file name, no URL) and a fixed prompt. The prompt tells the model to describe the item only, never a person, and to ignore any text in the image.
- OpenAI requests set `store: false`. Gemini uses `generateContent`, not the Interactions API (which stores interactions by default).
- Logs (`ai.call`, `ai.vision.result`, `ai.vision.invalid_output`) carry provider, model, version, outcome, latency, token counts, estimated cost and the colour verdict only: never images, prompts, outputs, attribute values, user ids or keys.
- The mobile add-item screen shows: "Rasm tahlil uchun tashqi AI xizmatiga yuborilishi mumkin." (The photo may be sent to an external AI service for analysis.) No retention claim is made; the provider's terms must be reviewed before launch (see the privacy checklist in [`provider-evaluation.md`](provider-evaluation.md)).

## Evaluation harness (manual, never in CI)

`apps/web/scripts/ai-eval/vision-eval.ts` runs a labelled dataset through each configuration of a matrix with the app's own pipeline (prepare → prompt and schema → validation → colour check), without retry, quota or database.

```sh
cd apps/web
GEMINI_API_KEY=… OPENAI_API_KEY=… bun scripts/ai-eval/vision-eval.ts \
  --dataset=/path/outside/repo/dataset \
  --matrix=scripts/ai-eval/matrix.example.json \
  --out=/path/outside/repo/results            # refused inside the repository
# --dry-run validates labels, files and matrix without calling anything
# --only=gemini-A-768,openai-A-768   --limit=20
```

**Dataset** (`<dataset>/labels.json`, photos next to it, both outside the repository):

```json
{ "items": [
  { "id": "g001", "file": "g001.jpg",
    "expected": { "subject": "single_garment", "category": "pants", "subcategory": "jeans", "primaryColor": "blue" } },
  { "id": "n001", "file": "n001.jpg", "expected": { "subject": "no_garment" } }
] }
```

- Ids and file names must be neutral (`[A-Za-z0-9_-]`). Garment photos only: no faces or identifiable people, no documents, no user photos without recorded consent.
- Labelled fields are scored; unlabelled fields are skipped; `null` means "should be null". Scored fields: category, subcategory, primaryColor (the model's first colour), pattern, material, sleeveLength, fit, style, gender, formality.
- Include non-garments, several garments and unclear photos, so false rejections and false acceptances are measured, and local garments (chapan, do‘ppi, atlas fabric).

**Matrix** (`matrix.example.json`): Gemini A/B and OpenAI A/B, each at 768 and 1024 px. The model ids and the one price in it are candidates noted during discovery: **check the current model ids, supported thinking levels and prices on the providers' pages before running**, and add `price` to every entry so cost is reported.

**Output:** `results.jsonl` (one line per config × item: provider, model, image settings, latency, input/output tokens, estimated cost, outcome, attribute values, raw confidences, colour verdict, per-field correctness; never the image, file name or provider payload), `summary.json` and `summary.md` (subject accuracy, false rejection/acceptance, invalid and error rates, per-field accuracy, colour conflict rate, p50/p95 latency, mean tokens, cost per 1,000, and a raw-confidence calibration table).

Scoring is unit-tested in `apps/web/tests/unit/ai/vision-eval.test.ts`.

## Before production

1. Run the harness on a frozen, consented dataset (about 100+ items); repeat each configuration to see variance.
2. Pick provider, model, `AI_VISION_MAX_SIDE` and resolution/detail from accuracy, false-rejection rate, latency, cost and the privacy review.
3. Verify live: the Gemini `thinkingLevel` values and `mediaResolution` strings for the chosen model, and OpenAI strict-schema acceptance. These are implemented from documentation and covered only by fixture tests.
4. Build a calibration table from the harness output, replace the 0.69 cap, and tune the colour thresholds.
5. Configure `AI_VISION_PROVIDER`, `AI_VISION_MODEL` and the key in production, and remove `AI_ALLOW_MOCK_IN_PRODUCTION` once the LLM role is also real.

Rolling back the provider choice needs no code change, only a restart with `AI_VISION_PROVIDER=mock` with `AI_ALLOW_MOCK_IN_PRODUCTION=1` (items keep their stored metadata).
