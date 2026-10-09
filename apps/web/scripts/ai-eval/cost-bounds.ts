/**
 * Pre-request cost estimates for the evaluation harnesses (bake-off and
 * real-data validation). Used by live-accounting.ts to reserve a conservative
 * cost BEFORE every outbound attempt; see docs/ai/provider-bakeoff.md
 * ("Cost reservation").
 *
 * Three parts, kept apart because they are not equally trustworthy:
 *
 * - Output tokens: DOCUMENTED BOUND. The request's own output limit, which both
 *   adapters send (OpenAI `max_completion_tokens`, Gemini `maxOutputTokens`).
 *   Both providers document that this limit covers reasoning / thinking tokens
 *   too. A request without an output limit has no bound: it is refused when a
 *   dollar budget is set.
 * - Image tokens: DOCUMENTED FORMULA, OpenAI gpt-5.4 family only. Patches of
 *   32 px over the actual dimensions of the image bytes being sent, × 1.2,
 *   with `detail` high or auto (OpenAI documents auto = high for gpt-5.4) and
 *   both sides at most 2048 px. OpenAI calls its own counts estimates (± 1 for
 *   rounding): one token of margin is added. Every other provider, model or
 *   setting has no image bound here (Gemini documents its per-image counts as
 *   approximate) and is refused when a dollar budget is set.
 * - Text input tokens: HEURISTIC — NOT A GUARANTEE. Message framing, the
 *   Structured Outputs schema encoding and other request overhead are not
 *   documented, so no local calculation is a proven upper bound. The estimate
 *   is UTF-8 bytes of the message text (byte-level tokenizers produce at most
 *   one content token per byte; typical text is ~3–4 bytes per token), plus
 *   the schema bytes × SCHEMA_BYTES_MULTIPLIER, plus fixed per-message and
 *   per-request allowances. None of these factors is a proven bound.
 *
 * Nothing here reads or records the content beyond its byte length and the
 * image dimensions.
 */
import sharp from 'sharp'
import type { LLMRequest, VisionRequest } from '../../src/lib/ai/providers/types'
import type { AiPrice } from '../../src/lib/ai/config'

/** Text-input heuristic: estimated tokens per UTF-8 byte of message text (HEURISTIC). */
export const TEXT_BYTES_MULTIPLIER = 1
/** Text-input heuristic: estimated tokens per UTF-8 byte of the JSON schema (HEURISTIC; the schema encoding is undocumented). */
export const SCHEMA_BYTES_MULTIPLIER = 2
/** Text-input heuristic: allowance per message for role and boundary tokens (HEURISTIC). */
export const PER_MESSAGE_OVERHEAD_TOKENS = 16
/** Text-input heuristic: allowance per request for priming, system and format overhead (HEURISTIC). */
export const PER_REQUEST_OVERHEAD_TOKENS = 256

/** OpenAI image tokens (documented, docs/guides/images-vision): models with 32 px patches and a 1.2 multiplier. */
export const OPENAI_PATCH_MODELS: Readonly<Record<string, number>> = { 'gpt-5.4': 1.2, 'gpt-5.4-mini': 1.2, 'gpt-5.4-nano': 1.2 }
/** Own keys only: a model id such as "constructor" must never read an inherited property. */
export const isOpenAIPatchModel = (model: string): boolean => Object.hasOwn(OPENAI_PATCH_MODELS, model)
const OPENAI_PATCH_PX = 32
const OPENAI_MAX_SIDE_PX = 2048
/** OpenAI: the documented counts are estimates that may differ by one token for rounding. */
const OPENAI_IMAGE_ROUNDING_MARGIN = 1

export const INPUT_ESTIMATE_STATUS = 'HEURISTIC_NOT_GUARANTEE'

export interface TokenEstimate {
  /** HEURISTIC_NOT_GUARANTEE: message text, schema and request overhead. */
  textInputTokens: number
  /** Documented formula (0 for text requests). */
  imageInputTokens: number
  /** Documented bound: the request's own output limit (reasoning / thinking included). */
  outputTokens: number
}

export type EstimateResult = { ok: true; tokens: TokenEstimate } | { ok: false; reason: string }

export interface CostEstimate {
  tokens: TokenEstimate
  textInputUsd: number
  imageInputUsd: number
  outputUsd: number
  totalUsd: number
}

const utf8 = (s: string) => Buffer.byteLength(s, 'utf8')

function outputBound(maxOutputTokens: number | undefined): number | null {
  return typeof maxOutputTokens === 'number' && Number.isInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : null
}

/** HEURISTIC text-input estimate for the given text parts and optional schema. */
export function textInputHeuristic(texts: readonly string[], schema: { name: string; schema: Record<string, unknown> } | undefined): number {
  const textBytes = texts.reduce((n, t) => n + utf8(t), 0)
  const schemaBytes = schema ? utf8(schema.name) + utf8(JSON.stringify(schema.schema)) : 0
  return Math.ceil(textBytes * TEXT_BYTES_MULTIPLIER + schemaBytes * SCHEMA_BYTES_MULTIPLIER) + texts.length * PER_MESSAGE_OVERHEAD_TOKENS + PER_REQUEST_OVERHEAD_TOKENS
}

/** Token estimate of one text attempt (both providers), or why there is none. */
export function estimateTextAttempt(req: LLMRequest): EstimateResult {
  const outputTokens = outputBound(req.maxOutputTokens)
  if (outputTokens === null) return { ok: false, reason: 'no output-token limit on the request' }
  return { ok: true, tokens: { textInputTokens: textInputHeuristic(req.messages.map((m) => m.content), req.jsonSchema), imageInputTokens: 0, outputTokens } }
}

/** Documented OpenAI image tokens for these dimensions, or null outside the supported settings. */
export function openaiImageTokens(model: string, detail: string, width: number, height: number): number | null {
  if (!isOpenAIPatchModel(model)) return null
  const multiplier = OPENAI_PATCH_MODELS[model]
  if (detail !== 'high' && detail !== 'auto') return null
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null
  if (width > OPENAI_MAX_SIDE_PX || height > OPENAI_MAX_SIDE_PX) return null
  const patches = Math.ceil(width / OPENAI_PATCH_PX) * Math.ceil(height / OPENAI_PATCH_PX)
  return Math.ceil(patches * multiplier) + OPENAI_IMAGE_ROUNDING_MARGIN
}

/**
 * Token estimate of one vision attempt, from the bytes actually being sent and
 * the settings the adapter applies, or why there is none.
 */
export async function estimateVisionAttempt(provider: string, model: string, req: VisionRequest): Promise<EstimateResult> {
  const outputTokens = outputBound(req.maxOutputTokens)
  if (outputTokens === null) return { ok: false, reason: 'no output-token limit on the request' }
  if (provider !== 'openai') return { ok: false, reason: `no documented image-token bound for ${provider}` }
  if (!isOpenAIPatchModel(model)) return { ok: false, reason: 'no documented image-token bound for this model' }
  // The OpenAI adapter sends req.options.openaiDetail, else 'auto'.
  const detail = req.options?.openaiDetail ?? 'auto'
  let width: number | undefined, height: number | undefined
  try {
    ;({ width, height } = await sharp(req.image).metadata())
  } catch {
    return { ok: false, reason: 'image dimensions unreadable' }
  }
  const imageInputTokens = openaiImageTokens(model, detail, width ?? 0, height ?? 0)
  if (imageInputTokens === null) return { ok: false, reason: 'image setting or size outside the documented bound (detail high/auto, sides ≤ 2048 px)' }
  // Mirrors the adapter: a vision request without a schema gets { type: 'object' }.
  const schema = req.jsonSchema ?? { name: 'vision_output', schema: { type: 'object' } }
  return { ok: true, tokens: { textInputTokens: textInputHeuristic([req.instruction], schema), imageInputTokens, outputTokens } }
}

/** Rounded UP to the micro-dollar: an estimate never rounds down. */
const usdUp = (tokens: number, usdPerMTok: number) => Math.ceil(tokens * usdPerMTok) / 1e6

export function costOf(tokens: TokenEstimate, price: AiPrice): CostEstimate {
  const textInputUsd = usdUp(tokens.textInputTokens, price.inputUsdPerMTok)
  const imageInputUsd = usdUp(tokens.imageInputTokens, price.inputUsdPerMTok)
  const outputUsd = usdUp(tokens.outputTokens, price.outputUsdPerMTok)
  return { tokens, textInputUsd, imageInputUsd, outputUsd, totalUsd: roundUsd(textInputUsd + imageInputUsd + outputUsd) }
}

export const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6

/** A usable reservation: every part a finite, non-negative amount (a NaN or negative estimate never passes a budget check). */
export function isSoundEstimate(c: CostEstimate): boolean {
  return [c.textInputUsd, c.imageInputUsd, c.outputUsd, c.totalUsd].every((v) => Number.isFinite(v) && v >= 0)
}

/** A price a dollar budget can rely on: both rates finite and above zero (a zero rate would reserve nothing). */
export function isBudgetablePrice(price: AiPrice | null): price is AiPrice {
  return !!price && Number.isFinite(price.inputUsdPerMTok) && Number.isFinite(price.outputUsdPerMTok) && price.inputUsdPerMTok > 0 && price.outputUsdPerMTok > 0
}
