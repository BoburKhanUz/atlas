/**
 * Content-free AI telemetry: one structured `ai.call` log line per feature
 * call. It records WHO answered and HOW it went, never WHAT was said: no
 * prompts, user messages, wardrobe data, images, provider payloads, user or
 * conversation ids, API keys or tokens.
 *
 * Field names avoid the logger's sensitive-key pattern (e.g. "token"), which
 * would otherwise redact the usage numbers.
 */
import { log } from '@/server/log'
import type { AiPrice } from './config'
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
}

export interface AiCallFields {
  feature: AiFeature
  provider: string
  model: string
  outcome: AiOutcome
  latencyMs: number
  attempts: number
  retried: boolean
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
  }
  if (r.usage?.inputTokens !== undefined) fields.usageInput = r.usage.inputTokens
  if (r.usage?.outputTokens !== undefined) fields.usageOutput = r.usage.outputTokens
  if (r.usage?.totalTokens !== undefined) fields.usageTotal = r.usage.totalTokens
  const cost = estimateCostUsd(r.usage, r.price)
  if (cost !== undefined) fields.costUsd = cost
  return fields
}

export function recordAiCall(r: AiCallRecord): void {
  const fields = aiCallFields(r)
  if (r.outcome === 'ok') log.info('ai.call', { ...fields })
  else log.warn('ai.call', { ...fields })
}
