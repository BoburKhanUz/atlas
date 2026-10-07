# AI privacy review (Phase 4.5)

Status: **engineering review, not a legal opinion.** The items marked **REQUIRES LEGAL REVIEW** need the data owner and counsel before real user data is sent to any provider. Reviewed against commit `516d2d1` plus the Phase 4.5 fixes listed at the end.

## What each provider receives

Nothing below includes a database id, user id, email, name, conversation id, image URL, storage key, file name or API key of another service. The key of the selected provider is sent only as a header (`x-goog-api-key` or `Authorization`), never in a URL.

### Clothing vision (`AI_VISION_PROVIDER`)

| Sent | Not sent |
|---|---|
| One JPEG produced by `prepareVisionImage`. It is decoded, rotated upright, flattened onto white and re-encoded at quality 85, with the longest side ≤ `AI_VISION_MAX_SIDE` (default 1024) and **no metadata** (EXIF, GPS, XMP and ICC are dropped by re-encoding). | The original upload, its file name, storage URL or key, database id, user id, EXIF/GPS. |
| The fixed garment instruction and JSON schema (`garment-analysis.ts`, version `v1`). | Any user text. |
| Tuning: Gemini media resolution and thinking level, or OpenAI `detail`. | |

Tests: `tests/regression/wardrobe-vision.test.ts` checks that the request has no file name, is upright, is within the size limit, is a JPEG and carries no metadata (a photo with EXIF orientation and GPS is used as input).

### Stylist (`AI_LLM_PROVIDER`)

| Sent | Not sent |
|---|---|
| The fixed system prompt (`stylist.ts`, `v1`). | Database ids (items are `W1…Wn`), user id, conversation id. |
| Wardrobe: at most 40 items, **catalog ids only** (category, subcategory, colours, pattern, material, style, season, fit, gender, formality). A value outside the catalog becomes `null`. | Images, image URLs, storage keys. (Wardrobe items have no name, notes or brand columns; the only free text a row can hold is in the attribute columns, and those are filtered to catalog ids.) |
| Up to 3 engine outfit candidates (W references, score, contrast). | |
| Weather: temperature, feels-like, precipitation probability, wind, humidity and UV, rounded; the condition from a fixed list. | Coordinates or any location. |
| Occasion id (if it is a known one); preferences (catalog ids only); colour-profile summary (season, undertone, contrast, palettes). | The selfie or any raw colour analysis. |
| History: the last 12 answered messages of this conversation, ≤ 2000 characters each. | Other conversations, or other users' data. |
| **The user's own message (≤ 2000 characters) and typed occasion (≤ 60), as untrusted JSON.** | |

**REQUIRES LEGAL REVIEW:** users can type anything, including personal information about themselves or others, and that text goes to the provider unchanged. The app cannot filter it reliably. The user-facing privacy notice must say that stylist messages are processed by a third-party AI provider.

### Outfit AI (`AI_LLM_PROVIDER`, `outfit_explanation`)

| Sent | Not sent |
|---|---|
| The fixed system prompt (`outfit-intelligence.ts`, `v1`). | Database ids (candidates are `O1…On`), user id. |
| Only the top-K engine candidates (≤ 5): score, reason codes, and per item: slot, category, subcategory, colours (≤ 5), pattern, material, style, formality, sleeves. **Catalog ids only** (Phase 4.5); anything else becomes `null` or is dropped. | Images, image URLs, fit/gender, other wardrobe items, anything outside the catalog. |
| Occasion id; weather derived values (band, rounded feels-like, rain, snow and wind categories). | Coordinates, the raw weather text. |
| Colour profile: season and undertone, and only when confidence ≥ 0.3. | Palettes, contrast, the selfie. |

### Colour profile

The colour profile is computed in-process (`color-analysis-v2`). The selfie is **never sent to any AI provider** and is not stored (see [`color-profile.md`](color-profile.md)).

### Weather (not an AI provider)

The weather service (Open-Meteo) receives coordinates **rounded to 2 decimals (≈ 1.1 km)**. This is a Phase 4.5 fix: the server used to forward the browser's coordinates at 4 decimals (≈ 11 m). The mobile app already rounds to 2 decimals before sending. The server never sends coordinates to an AI provider.

## Retention inside ATLAS

- **Telemetry** (`ai.call`, `ai.request`, `ai.quota`, `ai.*.failed`, `ai.outfit.fallback`) holds provider, model, feature, outcome or error code, HTTP status, latency, retries, quota actions, token counts and estimated cost. It never holds prompts, answers, wardrobe data, images, ids or keys. The `ai.call`, `ai.request` and `ai.quota` events also pass a field whitelist ([`monitoring.md`](monitoring.md)). Tests: `client-telemetry.test.ts`, `ai-prompt-injection.test.ts`, `outfit-generate.test.ts`, `wardrobe-vision.test.ts`.
- **Stylist conversations** are stored in `AiMessage` (user text, the resolved answer, and metadata without prompts). Deleting the account cascades.
- **Clothing analysis** stores the validated attributes and analysis metadata (provider, model, version, raw confidences). It never stores the provider payload.
- **Outfit AI** output is not stored, except the explanation when the user saves an outfit.
- **Evaluation artefacts** (`scripts/ai-eval`) contain synthetic data only and must be written outside the repository; the scripts refuse a path inside it.

## Provider data handling (official documentation, read 2026-10-06)

The summaries below come from the providers' own pages. They are not third-party summaries and they are not a legal interpretation.

### Gemini API (Google)

Source: [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (last updated 2026-04-28) and [usage policies / abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies).

- **Unpaid (free tier):** content is used "to provide, improve, and develop Google products and services and machine learning technologies". Human reviewers may read it. The terms say: "Do not submit sensitive, confidential, or personal information to the Unpaid Services." The pricing page marks free-tier models "Used to improve our products: Yes".
- **Paid services:** prompts and responses are not used to improve products and are processed under the Data Processing Addendum.
- **Abuse monitoring:** prompts and outputs are retained for **55 days** for policy enforcement only. They are not used for training (except policy-enforcement models). Authorised Google staff may access them for review.
- **Regions:** when serving users in the EEA, the UK or Switzerland, only Paid Services may be used.

**Requirement:** ATLAS must use a **paid** Gemini API project (billing enabled) for any real user data; the free tier is unacceptable for this app. **REQUIRES LEGAL REVIEW:** applicability of the DPA, data location, and the 55-day retention for selfie-free garment photos and stylist text.

### OpenAI API

Source: [Your data](https://developers.openai.com/api/docs/guides/your-data).

- API data is **not used for training** unless the organisation opts in (the policy has applied since 2023-03-01).
- **Abuse-monitoring logs** are kept for up to **30 days**, unless the law requires longer.
- **Zero Data Retention / Modified Abuse Monitoring** require prior approval from OpenAI. With ZDR, `store` is always treated as false.
- **Images** are scanned for CSAM. A flagged image is retained for manual review even with ZDR.
- **Data residency** is available in several regions, with a price uplift for newer models.
- ATLAS sends `store: false` on every Chat Completions call (it opts out of stored completions). It does not change abuse-monitoring retention.

**REQUIRES LEGAL REVIEW:** whether ZDR/MAM or a data-residency region is required for the target market, and the DPA.

## Open items

| Item | Status |
|---|---|
| Use a paid Gemini tier (never the free tier) with real data | Configuration and process; **REQUIRES LEGAL REVIEW** |
| DPA with the selected provider; data location; retention (55 / 30 days) | **REQUIRES LEGAL REVIEW** |
| User-facing notice that photos and stylist messages are processed by a third-party AI provider | **REQUIRES LEGAL REVIEW** |
| Users can type personal data into the stylist | Inherent; covered by the notice; **REQUIRES LEGAL REVIEW** |
| Provider-side logs are outside ATLAS's control | Documented; covered by the provider choice and contract |

## Phase 4.5 fixes from this review

1. Tests can no longer reach a real provider because of the developer's shell: the mock is pinned, keys and models are removed, and a network guard refuses the provider hosts (`tests/ai-test-env.ts`, `tests/setup.ts`, integration config; `test-isolation.test.ts`).
2. Outfit-AI context values are catalog ids only. Free text from a legacy or tampered row is never forwarded (`ai-prompt-injection.test.ts`).
3. Weather coordinates are rounded to 2 decimals before the third-party call (`weather-privacy.test.ts`).
