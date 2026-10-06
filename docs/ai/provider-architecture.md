# AI provider architecture (Phase 4.0; vision 4.1; stylist 4.2)

ATLAS calls AI only from the backend. The mobile app and the web client call the ATLAS API; provider credentials exist only in the server's environment.

```
Flutter / web ─▶ ATLAS API (route handlers)
                    │
                    ▼
        AI application layer            apps/web/src/lib/ai/
        ├─ stylist-service.ts           stylist turn: quota, structured answer, grounding (4.2)
        │   ├─ stylist.ts               versioned prompt, schema, validation, W-reference resolution
        │   └─ stylist-context.ts       bounded context: ≤ 40 items, candidates, weather, colour profile, history
        ├─ outfit-intelligence.ts       explanation of the top outfit
        ├─ vision-service.ts            clothing analysis (real provider or mock; 4.1)
        │   ├─ garment-analysis.ts      versioned prompt, strict schema, validation
        │   └─ color-check.ts           pixel cross-check of the primary colour
        └─ color-service.ts             selfie colours (deterministic, in-process)
                    │
                    ▼
        client.ts  ── timeout · one safe retry · telemetry (ai.call)
                    │
                    ▼
        Provider layer                  apps/web/src/lib/ai/providers/
        ├─ gemini.ts   REST generateContent  (candidate)
        ├─ openai.ts   REST chat/completions (candidate)
        └─ mock.ts     deterministic, development and tests
```

The application layer never imports an adapter. It calls `generateText` or `analyzeImage` in `client.ts` with a feature name, and the registry (`providers/index.ts`) picks the configured provider.

## Contracts (`providers/types.ts`)

- `LLMProvider.generate({ messages, temperature?, maxOutputTokens?, jsonSchema?, timeoutMs, signal? })` returns `{ text, metadata }`.
- `VisionProvider.analyzeImage({ image, mimeType, maxSide, instruction, jsonSchema?, maxOutputTokens?, options?, timeoutMs, signal? })` returns `{ output, metadata }`. `options` carries provider-specific image settings (Gemini `mediaResolution` and thinking level, OpenAI `detail`); each adapter reads only its own.
  - `output` is untrusted parsed JSON; the application layer validates it.
  - The image must be prepared first with `prepareVisionImage(bytes, maxSide)`, which decodes, rotates upright, strips EXIF and GPS, flattens transparency onto white, re-encodes as JPEG, fits the image inside `maxSide` (≤ 2048, never enlarged) and refuses a result over 4 MB.
  - Adapters refuse an image that is empty, over 4 MB, of another type, or has an out-of-range `maxSide`.
- `metadata` is `{ provider, model, usage: { inputTokens?, outputTokens?, totalTokens? } }`.
- Errors are `AiProviderError` with a `kind`. Messages carry the provider name, kind and HTTP status only, never a response body, prompt or key.

| Kind | Cause | Retried |
|---|---|---|
| `timeout` | per-attempt timeout | yes |
| `network` | no HTTP response | yes |
| `rate_limited` | HTTP 429 | yes, if Retry-After ≤ 3 s |
| `unavailable` | HTTP 500, 502, 503, 504 | yes |
| `auth` | HTTP 401, 403 | no |
| `invalid_request` | other HTTP 4xx, or an invalid request refused before sending | no |
| `malformed_response` | 2xx with an unexpected shape, empty output, or invalid JSON | no |
| `content_filtered` | blocked prompt, safety finish, or refusal | no |
| `provider_error` | any other status (e.g. 501) | no |
| `cancelled` | the caller aborted | no |
| `config` | missing key | no |

There is at most **one** retry, with a 400–800 ms jittered wait, or the Retry-After value for a 429. Provider calls have no side effects on ATLAS data, so a retry cannot duplicate anything.

## Adapters

| | Gemini | OpenAI |
|---|---|---|
| Endpoint | `POST /v1beta/models/{model}:generateContent` | `POST /v1/chat/completions` |
| Auth | `x-goog-api-key` header (never in the URL) | `Authorization: Bearer` |
| System messages | `systemInstruction` (joined) | `system` messages |
| JSON output | `responseMimeType` + `responseJsonSchema` | `response_format` `json_schema`, `strict: true` |
| Images | text first, then `inlineData` (base64); `mediaResolution` | `image_url` data URL with `detail` |
| Notes | `thought` parts are dropped; `thinkingConfig.thinkingLevel` for vision; `thoughtsTokenCount` counts as output usage | `store: false`; temperature omitted for fixed-temperature families (gpt-5, gpt-6, o-series) |

Both adapters use the platform `fetch`, with no SDK dependency. Neither is the selected provider: the model id is always configured explicitly, and the choice is made by the bake-off in [`provider-evaluation.md`](provider-evaluation.md).

## Configuration

Configuration is read and validated at startup by `assertServerConfig`. All variables are listed in `.env.example`.

| Variable | Rule |
|---|---|
| `AI_LLM_PROVIDER` | `mock`, `gemini` or `openai`. Development defaults to `mock`. Production must set it. |
| `AI_LLM_MODEL` | Required for `gemini` and `openai` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Required for the selected provider |
| `AI_LLM_TIMEOUT_MS` | 1000–55000 ms, default 25000. The outfit explanation uses 15000. |
| `AI_LLM_PRICE_INPUT_USD_PER_MTOK`, `AI_LLM_PRICE_OUTPUT_USD_PER_MTOK` | Optional; set both or neither. Enables `costUsd` in telemetry. |
| `AI_VISION_PROVIDER` | `mock`, `gemini` or `openai`. Development defaults to `mock`. Production must set it. |
| `AI_VISION_MODEL` | Required for `gemini` and `openai` (the key is the same `GEMINI_API_KEY` / `OPENAI_API_KEY`) |
| `AI_VISION_TIMEOUT_MS` | 1000–55000 ms, default 15000 (two attempts fit the 60 s route and the app's 70 s upload timeout) |
| `AI_VISION_MAX_SIDE` | 256–2048 px, default 1024 |
| `AI_VISION_RESOLUTION` | Gemini `mediaResolution`: `low`, `medium`, `high` (default), `ultra_high` |
| `AI_VISION_GEMINI_THINKING_LEVEL` | `none`, `minimal`, `low` (default), `medium`, `high`; `none` sends no thinking config |
| `AI_VISION_DETAIL` | OpenAI image `detail`: `low`, `high` (default), `auto` |
| `AI_VISION_PRICE_INPUT_USD_PER_MTOK`, `AI_VISION_PRICE_OUTPUT_USD_PER_MTOK` | Optional, as for the LLM |
| `AI_ALLOW_MOCK_IN_PRODUCTION` | `1` acknowledges mock AI (either role) in a production build |
| `LLM_PROVIDER` | Removed. Setting it fails at startup instead of being silently ignored. |

**Production fails closed.** For each role (LLM and vision) it refuses a missing provider, the mock, or a real provider without its key or model. With real providers for both roles, a production build starts without any flag. `AI_ALLOW_MOCK_IN_PRODUCTION=1` is only for local Docker and the e2e suite, which run production builds with the mock; a real deployment must not set it.

## Telemetry

Every AI call writes one structured `ai.call` log line. The level is `info` on success and `warn` on failure. The fields are:

`feature`, `provider`, `model`, `outcome` (`ok`, an error kind, or `error`), `latencyMs`, `attempts`, `retried`, `usageInput`, `usageOutput`, `usageTotal`, `costUsd`.

The line never contains prompts, user messages, wardrobe data, images, provider responses, user or conversation ids, keys or tokens.

## Quota foundation

`src/lib/ai/quota.ts` and the `AiUsage` table (migration `20261007000000_ai_usage`) hold per-user, per-feature, per-day counters. The day is Uzbekistan time (UTC+5).

| Feature | Daily limit |
|---|---|
| `stylist_chat` | 50 |
| `clothing_analysis` | 50 |
| `color_analysis` | 10 |

- `consumeAiQuota` increments with a single `INSERT … ON CONFLICT … WHERE count < limit`, so concurrent requests cannot exceed the limit. `refundAiQuota` gives one call back.
- The rows cascade with the account.
- Rollback: `docs/database/rollback/down-ai-usage.sql`.
- **`clothing_analysis` is enforced since Phase 4.1** for real vision providers only (the mock never consumes quota): `POST /api/v1/wardrobe/items` answers 429 `AI_QUOTA_EXCEEDED` with `Retry-After` = seconds until the next Uzbekistan day. See [`vision-evaluation.md`](vision-evaluation.md) for when a call is charged or refunded. **`stylist_chat` is enforced since Phase 4.2** the same way (real providers only): `POST /api/v1/stylist/chat` answers 429 `AI_QUOTA_EXCEEDED`; see [`stylist-evaluation.md`](stylist-evaluation.md). `color_analysis` is not enforced yet.

## Behaviour kept from before Phase 4.0

- Phase 4.0 kept the stylist prompt and its soft fallback (HTTP 200 with a fixed apology, stored as `fallback: true`). **Phase 4.2 replaced both:** a versioned structured-output prompt, and failures that answer 503 `AI_UNAVAILABLE` and store nothing. See [`stylist-evaluation.md`](stylist-evaluation.md).
- The outfit explanation covers the top candidate only: temperature 0.5, at most 180 tokens. A failure gives `explanation: null`. Previously, a bad `LLM_PROVIDER` turned the whole request into a 500.
- Colour analysis is unchanged. With `AI_VISION_PROVIDER=mock`, clothing analysis is byte-for-byte the previous deterministic result and `detection.mock` is `true`.
- The mock text says it is a demo ("Demo rejim: …").
- Phase 4.0 left the OpenAPI contract unchanged. Phase 4.1 changed it: `Detection.mock` is a boolean (false for a real provider) and `createWardrobeItem` can answer `NOT_A_GARMENT` 422, `AI_QUOTA_EXCEEDED` 429 and `AI_UNAVAILABLE` 503.
