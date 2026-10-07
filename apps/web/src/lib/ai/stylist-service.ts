/**
 * One stylist turn (Phase 4.2): quota → provider (structured JSON) →
 * validation and grounding → at most one correction attempt → resolved
 * answer. Persistence stays in the route, which stores the user message and
 * the answer together only after this returns: a failure leaves nothing
 * behind and never becomes a fake assistant message.
 *
 * Failures (`StylistError`):
 *   quota_exceeded → 429 AI_QUOTA_EXCEEDED (nothing charged)
 *   ai_unavailable → 503 AI_UNAVAILABLE   (provider error, timeout, malformed
 *                    or ungrounded output after the correction; refunded)
 * The mock provider answers deterministically and never uses quota.
 */
import { generateText } from './client'
import { getAiConfig } from './config'
import { isAiProviderError } from './providers/errors'
import { getLLMProvider } from './providers'
import type { LLMMessage } from './providers/types'
import { recordAiRequest } from './monitoring'
import { decideAiEligibility } from './rollout'
import { secondsUntilNextQuotaDay } from './quota'
import { chargeQuota, refundQuota } from './quota-monitoring'
import {
  InvalidStylistOutputError,
  STYLIST_LIMITS,
  STYLIST_PROMPT_VERSION,
  STYLIST_SYSTEM_PROMPT,
  interpretStylistOutput,
  mockStylistOutput,
  parseStylistText,
  resolveReferences,
  stylistJsonSchema,
  type StylistAnswer,
} from './stylist'
import { historyMessages, stylistMessages, type BuiltContext, type HistoryRow } from './stylist-context'
import { recordAiCall } from './telemetry'
import { log } from '@/server/log'

/**
 * Whole-turn budget: below the route's 60 s maxDuration and the app's 70 s
 * AI receive timeout. Each provider call gets min(AI_LLM_TIMEOUT_MS, what is
 * left); the client's single retry and the single correction share it.
 */
export const STYLIST_DEADLINE_MS = 50_000

export type StylistFailure = { kind: 'ai_unavailable' } | { kind: 'quota_exceeded'; retryAfterSeconds: number }

export class StylistError extends Error {
  constructor(readonly failure: StylistFailure) {
    super(`stylist failed: ${failure.kind}`)
    this.name = 'StylistError'
  }
}

export interface StylistTurnInput {
  userId: string
  /** Trimmed, 1–2000 characters. */
  message: string
  /** The occasion text the user typed (untrusted), or null. */
  occasionText: string | null
  context: BuiltContext
  history: HistoryRow[]
}

export interface StylistTurnResult {
  /** Shown to the user and stored: references resolved to item names. */
  text: string
  /** Database ids of the referenced wardrobe items (stored, never returned). */
  referencedItemIds: string[]
  needsMoreInfo: boolean
  provider: string
  model: string
  promptVersion: string
  /** When quota was consumed (the route refunds that day if storing fails); null for the mock. */
  chargedAt: Date | null
}

export interface StylistDeps {
  now?: () => Date
  /** Monotonic clock for the deadline (ms). */
  clock?: () => number
}

function finish(answer: StylistAnswer, ctx: BuiltContext, meta: { provider: string; model: string; chargedAt: Date | null }): StylistTurnResult {
  return {
    text: resolveReferences(answer.answer, ctx.items),
    referencedItemIds: answer.referencedItems.map((r) => ctx.items.get(r)!.id),
    needsMoreInfo: answer.needsMoreInfo,
    promptVersion: STYLIST_PROMPT_VERSION,
    ...meta,
  }
}

/** The single correction after ungrounded references (also used by the evaluation harness). */
export function stylistCorrectionMessages(messages: LLMMessage[], previous: string, invalidRefs: readonly string[], refs: readonly string[]): LLMMessage[] {
  const allowed = refs.length > 0 ? `${refs[0]}–${refs[refs.length - 1]}` : 'none (the wardrobe list is empty)'
  return [
    ...messages,
    { role: 'assistant', content: previous },
    {
      role: 'system',
      content:
        `Your previous answer used wardrobe references that do not exist in the context: ${invalidRefs.join(', ') || 'unknown'}. ` +
        `Valid references: ${allowed}. Answer again using only valid references, without inventing items.`,
    },
  ]
}

export async function runStylistTurn(input: StylistTurnInput, deps: StylistDeps = {}): Promise<StylistTurnResult> {
  const now = deps.now ?? (() => new Date())
  const provider = getLLMProvider()

  // Phase 5.0 rollout: no provider (and no mock substitute) unless eligible.
  const eligibility = decideAiEligibility('stylist_chat', input.userId)
  if (!eligibility.eligible) {
    recordAiRequest({ feature: 'stylist_chat', provider: provider.name, model: provider.model, outcome: 'disabled', reason: eligibility.reason, billable: false })
    throw new StylistError({ kind: 'ai_unavailable' })
  }

  if (provider.name === 'mock') {
    const started = performance.now()
    const answer = interpretStylistOutput(mockStylistOutput(input.context), input.context.refs)
    recordAiCall({ feature: 'stylist_chat', provider: 'mock', model: provider.model, outcome: 'ok', latencyMs: performance.now() - started, attempts: 1 })
    recordAiRequest({ feature: 'stylist_chat', provider: 'mock', model: provider.model, outcome: 'ok', billable: false, latencyMs: performance.now() - started })
    return finish(answer, input.context, { provider: 'mock', model: provider.model, chargedAt: null })
  }

  // Quota, immediately before the provider call; refunds target the charged day.
  const started = performance.now()
  let corrected = false
  const request = (r: { outcome: 'ok' | 'ai_unavailable' | 'quota_exceeded' | 'internal_error'; reason?: string; billable: boolean }) =>
    recordAiRequest({ feature: 'stylist_chat', provider: provider.name, model: provider.model, corrected, latencyMs: performance.now() - started, ...r })
  const chargedAt = now()
  const quota = await chargeQuota(input.userId, 'stylist_chat', provider.name, chargedAt)
  if (!quota.allowed) {
    request({ outcome: 'quota_exceeded', billable: false })
    throw new StylistError({ kind: 'quota_exceeded', retryAfterSeconds: secondsUntilNextQuotaDay(chargedAt) })
  }
  const refund = (reason: string) => refundQuota(input.userId, 'stylist_chat', provider.name, chargedAt, reason)
  const unavailable = async (reason: string): Promise<never> => {
    await refund(reason)
    log.warn('ai.stylist.failed', { provider: provider.name, model: provider.model, version: STYLIST_PROMPT_VERSION, reason })
    request({ outcome: 'ai_unavailable', reason, billable: false })
    throw new StylistError({ kind: 'ai_unavailable' })
  }

  const clock = deps.clock ?? (() => performance.now())
  const deadline = clock() + STYLIST_DEADLINE_MS
  const deadlineSignal = AbortSignal.timeout(STYLIST_DEADLINE_MS)
  const llmTimeout = getAiConfig().llm.timeoutMs
  const schema = { name: 'stylist_answer', schema: stylistJsonSchema(input.context.refs) }

  const call = async (messages: LLMMessage[]): Promise<string> => {
    const remaining = Math.floor(deadline - clock())
    if (remaining < 1_000) return unavailable('deadline')
    try {
      const r = await generateText('stylist_chat', {
        messages,
        temperature: 0.7,
        maxOutputTokens: STYLIST_LIMITS.maxOutputTokens,
        jsonSchema: schema,
        timeoutMs: Math.min(llmTimeout, remaining),
        signal: deadlineSignal,
      })
      return r.text
    } catch (err) {
      if (isAiProviderError(err)) return unavailable(`provider_${err.kind}`)
      await refund('internal_error')
      request({ outcome: 'internal_error', reason: 'internal_error', billable: false })
      throw err
    }
  }

  const messages = stylistMessages({
    system: STYLIST_SYSTEM_PROMPT,
    context: input.context.data,
    history: historyMessages(input.history),
    message: input.message,
    occasionText: input.occasionText,
  })

  const first = await call(messages)
  let answer: StylistAnswer
  try {
    answer = interpretStylistOutput(parseStylistText(first), input.context.refs)
  } catch (err) {
    if (!(err instanceof InvalidStylistOutputError)) throw err
    // Malformed output is never retried; only ungrounded references get one correction.
    if (err.reason !== 'invalid_reference') return unavailable('malformed_output')
    corrected = true
    const second = await call(stylistCorrectionMessages(messages, first, err.invalidRefs, input.context.refs))
    try {
      answer = interpretStylistOutput(parseStylistText(second), input.context.refs)
    } catch (again) {
      if (!(again instanceof InvalidStylistOutputError)) throw again
      return unavailable(again.reason === 'invalid_reference' ? 'ungrounded_after_correction' : 'malformed_output')
    }
  }
  request({ outcome: 'ok', billable: true })
  return finish(answer, input.context, { provider: provider.name, model: provider.model, chargedAt })
}
