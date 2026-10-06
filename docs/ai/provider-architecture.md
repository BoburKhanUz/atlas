# AI provider architecture (Phase 4.0)

ATLAS calls AI only from the backend. The mobile app and the web client call the ATLAS API; provider credentials exist only in the server's environment.

```
Flutter / web ─▶ ATLAS API (route handlers)
                    │
                    ▼
        AI application layer            apps/web/src/lib/ai/
        ├─ stylist.ts                   stylist chat (prompt + context, unchanged)
        ├─ outfit-intelligence.ts       explanation of the top outfit
        ├─ vision-service.ts            clothing analysis (mock until 4.1)
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
- `VisionProvider.analyzeImage({ image, mimeType, maxSide, instruction, jsonSchema?, maxOutputTokens?, timeoutMs, signal? })` returns `{ output, metadata }`.
  - `output` is untrusted parsed JSON; the application layer validates it.
  - The image must be prepared first with `prepareVisionImage(bytes, maxSide)`, which decodes, rotates upright, strips EXIF and GPS, re-encodes as JPEG and fits the image inside `maxSide` (≤ 2048).
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
| Images | `inlineData` (base64) | `image_url` data URL |
| Notes | `thought` parts are dropped | `store: false`; temperature omitted for fixed-temperature families (gpt-5, gpt-6, o-series) |

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
| `AI_VISION_PROVIDER` | `mock` only, until Phase 4.1 |
| `AI_ALLOW_MOCK_IN_PRODUCTION` | `1` acknowledges mock AI in a production build |
| `LLM_PROVIDER` | Removed. Setting it fails at startup instead of being silently ignored. |

**Production fails closed.** It refuses a missing provider, the mock, or a real provider without its key or model. Clothing analysis is still the mock until Phase 4.1, so a production build can only start today with `AI_ALLOW_MOCK_IN_PRODUCTION=1`. Local Docker and the e2e suite use that flag. A real deployment must not use it once real vision exists.

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
- **Not enforced by any route yet.** Enforcing adds HTTP 429 responses to the public API and needs its own approval.

## Behaviour kept from before Phase 4.0

- The stylist prompt and context are unchanged. Temperature is 0.7, with at most 600 output tokens.
- On provider failure the stylist still answers HTTP 200 with the fixed apology. The stored message is now marked `fallback: true`, with provider `none`; it was hard-coded to `zai`. Not presenting this as an AI answer is Phase 4.2 work.
- The outfit explanation covers the top candidate only: temperature 0.5, at most 180 tokens. A failure gives `explanation: null`. Previously, a bad `LLM_PROVIDER` turned the whole request into a 500.
- Clothing and colour analysis results are byte-for-byte the previous deterministic ones; `detection.mock` is still `true`.
- The mock text says it is a demo ("Demo rejim: …").
- The OpenAPI contract and the generated mobile client are unchanged.
