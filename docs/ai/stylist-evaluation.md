# AI stylist (Phase 4.2) and its evaluation

Status: **implemented behind configuration, not evaluated.** Gemini and OpenAI are both supported as candidates (`AI_LLM_PROVIDER`, `AI_LLM_MODEL`); neither is selected. The stylist must not be called production-ready until the live checks and the evaluation below have been done.

## Request flow

`POST /api/v1/stylist/chat` (route: `apps/web/src/app/api/v1/stylist/chat/route.ts`):

1. Auth; request validation: `message` trimmed, 1–2000 characters; `event` (occasion) trimmed, ≤ 60 characters, blank = none.
2. **Ownership:** a `conversationId` must belong to the caller. Unknown and foreign ids both answer 404 `NOT_FOUND` (indistinguishable) and never create a replacement conversation. No id = a new conversation, created only when the turn succeeds.
3. **Idempotency (optional `Idempotency-Key`, 24 h):** the same key and payload replays the stored answer (`Idempotent-Replayed: true`) without calling the provider or charging quota; another payload → 409 `IDEMPOTENCY_KEY_MISMATCH`; still running → 409 `IDEMPOTENCY_IN_PROGRESS` + `Retry-After`. The mobile app sends a new key with every explicit send and re-uses it only when the user confirms re-sending the same text after a lost answer.
4. Bounded context (`stylist-context.ts`, below) and the deterministic outfit engine's top 3 candidates.
5. **Quota** (real providers only): one `stylist_chat` unit, 50 per user per Uzbekistan day, atomic (`AiUsage`). At the limit → 429 `AI_QUOTA_EXCEEDED`, `Retry-After` = seconds to Tashkent midnight.
6. Provider call (`stylist-service.ts`): structured JSON, at most one transport retry (client.ts), per-call timeout `min(AI_LLM_TIMEOUT_MS, time left)`, whole turn ≤ 50 s (route limit 60 s, app receive timeout 70 s).
7. Validation and grounding (`stylist.ts`), with at most one correction call for invalid references.
8. References resolved to item names; the user message and the answer are stored **together in one transaction** (which also completes the idempotency key) → 200.

## Outcomes

| Outcome | HTTP | Quota | Stored |
|---|---|---|---|
| Success | 200 | charged | user message + answer (one transaction) |
| Replay (same Idempotency-Key and payload) | 200 + `Idempotent-Replayed` | not charged, no provider call | — |
| Invalid request / unknown or foreign conversation | 400 / 404 | never reached | nothing |
| Daily limit | 429 `AI_QUOTA_EXCEEDED` | — | nothing |
| Provider error (timeout, network, 429/5xx after the retry, auth, config, safety refusal) | 503 `AI_UNAVAILABLE`, `Retry-After: 15` | refunded | nothing |
| Malformed output (not JSON, wrong shape, extra fields, empty or > 1500-character answer) | 503 `AI_UNAVAILABLE` | refunded | nothing (never retried) |
| Invalid references after the one correction | 503 `AI_UNAVAILABLE` | refunded | nothing |
| Storing fails after a good answer | 500 | refunded | nothing (transaction rolled back) |

There is no fake answer any more: the old "Kechirasiz…" apology is never stored or returned as an assistant message. Because a failed turn stores nothing, 503 and 429 are definite "not stored" for clients; the mobile app keeps the draft and lets the user send again. A lost response (timeout, connection drop) stays "unknown" in the app: it never re-sends automatically, offers to reload the transcript, and a confirmed re-send of the same text repeats the request with the same key, so the server returns the stored answer instead of a duplicate.

## Context (what the model sees)

Three kinds of messages, never concatenated:

1. **SYSTEM** — the trusted, versioned prompt (`STYLIST_SYSTEM_PROMPT`, `STYLIST_PROMPT_VERSION = "v1"`).
2. **CONTEXT** (system role) — JSON built only from stored data, each value reduced to a catalog id:
   - `wardrobe`: at most 40 items, each `{ref: "W1"…, category, subcategory, colors, pattern, material, style, season, fit, gender, formality}`. No database ids, image bytes or URLs.
   - `wardrobeTotal`, `outfitCandidates` (the engine's top 3 as references, score, contrast).
   - `weather`: the client's complete snapshot (the app only sends weather while it is fresh, from `/api/v1/weather/current`), rounded, condition reduced to a known id; otherwise `{available: false}`. No location is sent.
   - `occasion`: a catalog occasion id when the user's text is one, else null.
   - `preferences` (styles, colours, fit) and `colorProfile` (season, undertone, contrast, colour lists) when stored; null otherwise. No selfie, no raw analysis, no gender/body/skin profile fields, no email or user id.
3. **History + USER** — the last 12 meaningful messages, then the current turn as JSON `{"message": …, "occasion": …}` so user text cannot escape its field. History leaves out legacy fallback apologies, mock ("Demo rejim") answers, and questions whose answer was left out; each message ≤ 2000 characters. No conversation summarisation.

**Wardrobe selection** (deterministic): engine-candidate items first; then rounds over the categories taking each category's most relevant remaining item, ranked by occasion formality (+3/−2), weather season fit from the felt temperature (+2/−2), preferred/disliked style (+2/−3), favourite/disliked colour (+1/−2), and colour-profile recommended/caution colour (+1/−1); ties → newest, then id.

## Grounding and output

- Output schema (strict, provider-independent): `{answer: string, referencedItems: string[], needsMoreInfo: boolean}`, no other fields. `referencedItems` is an enum of this request's references (W1…Wn).
- The model writes items as `[W3]`. Every reference — listed or written in the text, with or without brackets — must exist in this request's context.
- An invalid reference gets **one** correction call to the same provider (naming the invalid references and the valid range). If the correction is still invalid or malformed → 503; nothing is stored.
- Resolution replaces each validated reference token with the item's Uzbek name from the catalog (e.g. "oq oksford ko‘ylak", "ko‘k (navy) chinos"); an unknown token throws instead of leaking. Users never see `W…` references or database ids. The stored assistant metadata keeps `provider`, `model`, `promptVersion`, `needsMoreInfo`, the context summary and the referenced item ids (server-side only).

## Prompt-injection defences

- User text (message, occasion) is only in user-role messages, as JSON; never in system messages.
- Wardrobe, preference and colour-profile values are reduced to catalog ids, so stored free text cannot reach the model; client weather `condition` is reduced to a known id.
- The prompt states that context and user text are data, to ignore requests to reveal instructions/ids or call APIs, and never to claim actions.
- Output can only reach users through the strict schema, reference validation and resolution.
- Tests: `tests/unit/ai/stylist*.test.ts`, `tests/regression/stylist-chat.test.ts`.

## Privacy

Sent to the provider: the prompt, the sanitized context above, recent conversation text and the user's message. Never: passwords, tokens, user/conversation/database ids, email, URLs, images or selfies, location. Logs (`ai.call`, `ai.stylist.failed`) carry provider, model, prompt version, outcome/reason, latency, token counts and cost only — never messages, answers, wardrobe data or conversation ids. OpenAI requests set `store: false`; Gemini uses `generateContent`.

## Mock

With `AI_LLM_PROVIDER=mock` (development, e2e, local Docker) the answer is deterministic, starts with "Demo rejim:", names the engine's top outfit (or asks for items when the wardrobe is empty), goes through the same validation and resolution, and never uses quota.

## Evaluation (before production)

Not done yet. Required:

1. **Live smoke test** per candidate with synthetic wardrobe data only: strict-schema acceptance (OpenAI), `responseJsonSchema` with the per-request enum (Gemini), latency against the 50 s budget, token usage.
2. **Prompt set:** about 50 Uzbek prompts (occasions, weather, empty/small/large wardrobes, follow-ups, other languages, injection attempts in the message and occasion), each with a rubric. Native speakers score blind to the provider: Uzbek quality, usefulness, grounding, brevity.
3. **Automatic metrics** per candidate: schema-valid rate, invalid-reference rate before/after correction, 503 rate, p50/p95 latency, tokens and cost per 1,000 turns, `needsMoreInfo` rate.
4. Privacy review of each provider's terms (see the checklist in [`provider-evaluation.md`](provider-evaluation.md)).
5. Then choose the provider and model and set `AI_LLM_PROVIDER`, `AI_LLM_MODEL` and the key in production.

Rolling back the provider choice needs no code change, only a restart with `AI_LLM_PROVIDER=mock` and `AI_ALLOW_MOCK_IN_PRODUCTION=1`. No database migration was added in Phase 4.2.
