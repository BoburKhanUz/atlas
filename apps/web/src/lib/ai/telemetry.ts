/**
 * Content-free AI telemetry: one structured `ai.call` log line per feature
 * call. It records WHO answered and HOW it went, never WHAT was said: no
 * prompts, user messages, wardrobe data, images, provider payloads, user or
 * conversation ids, API keys or tokens.
 *
 * Field names avoid the logger's sensitive-key pattern (e.g. "token"), which
 * would otherwise redact the usage numbers.
 */
import type { AiPrice } from './config'
import { emitAiEvent } from './monitoring'
import type { AiErrorKind } from './providers/errors'
import type { AiFeature, ProviderUsage } from './providers/types'

export type AiOutcome = 'ok' | 'error' | AiErrorKind

export interface AiCallRecord {
  feature: AiFeature
  provider: string
  model: string
  outcome: AiOutcome
  latencyMs: number
  attempts: number
  usage?: ProviderUsage
  price?: AiPrice | null
  /** HTTP status of the provider's final failure, when there was one. */
  httpStatus?: number
}

/** none: one attempt · succeeded: retried, then ok · failed: retried, still failed. */
export type AiRetryResult = 'none' | 'succeeded' | 'failed'

export interface AiCallFields {
  feature: AiFeature
  provider: string
  model: string
  outcome: AiOutcome
  latencyMs: number
  attempts: number
  retried: boolean
  retry: AiRetryResult
  success: boolean
  /** The typed error kind of a failed call (same as outcome). */
  errorCode?: AiOutcome
  httpStatus?: number
  usageInput?: number
  usageOutput?: number
  usageTotal?: number
  costUsd?: number
}

/** Estimated USD cost, when both a price and token counts are known. */
export function estimateCostUsd(usage: ProviderUsage | undefined, price: AiPrice | null | undefined): number | undefined {
  if (!price || !usage || usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined
  const usd = (usage.inputTokens * price.inputUsdPerMTok + usage.outputTokens * price.outputUsdPerMTok) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

export function aiCallFields(r: AiCallRecord): AiCallFields {
  const fields: AiCallFields = {
    feature: r.feature,
    provider: r.provider,
    model: r.model,
    outcome: r.outcome,
    latencyMs: Math.max(0, Math.round(r.latencyMs)),
    attempts: r.attempts,
    retried: r.attempts > 1,
    retry: r.attempts <= 1 ? 'none' : r.outcome === 'ok' ? 'succeeded' : 'failed',
    success: r.outcome === 'ok',
  }
  if (r.outcome !== 'ok') fields.errorCode = r.outcome
  if (r.httpStatus !== undefined) fields.httpStatus = r.httpStatus
  if (r.usage?.inputTokens !== undefined) fields.usageInput = r.usage.inputTokens
  if (r.usage?.outputTokens !== undefined) fields.usageOutput = r.usage.outputTokens
  if (r.usage?.totalTokens !== undefined) fields.usageTotal = r.usage.totalTokens
  const cost = estimateCostUsd(r.usage, r.price)
  if (cost !== undefined) fields.costUsd = cost
  return fields
}

/** One `ai.call` event (info when ok, warn otherwise), through the monitoring sinks. */
export function recordAiCall(r: AiCallRecord): void {
  emitAiEvent({ event: 'ai.call', ...aiCallFields(r) })
}
