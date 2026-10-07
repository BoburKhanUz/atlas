/**
 * Live bake-off accounting (Phase 5.1): what a live run spent and how the
 * provider behaved, without any content. Pure apart from the provider calls
 * it wraps; unit-tested in tests/unit/ai/bakeoff-live.test.ts and
 * tests/unit/ai/bakeoff-accounting.test.ts.
 *
 * Vocabulary (see docs/ai/provider-bakeoff.md, "Metric definitions"):
 * - attempt: one real provider API call (initial, retry or correction; a
 *   failed or timed-out call is still an attempt).
 * - request: one logical request (vision: the image; text: the first request,
 *   plus the correction when there is one).
 * - retry: an attempt that follows a retryable failure of the same request
 *   (counted when it happens). For requests that reached the provider,
 *   attempts = requests + retries.
 * - skipped: an attempt refused locally (circuit open or budget exhausted):
 *   never a provider call, never counted as an attempt.
 *
 * - CallLedger counts attempts, the error kind of each failed attempt,
 *   timeouts and tokens, per provider × feature × run (a fresh ledger each
 *   time: no state crosses providers, features or runs).
 * - Circuit breaker, per ledger: after CIRCUIT_MAX_FATAL auth/config/
 *   invalid-request failures, or CIRCUIT_MAX_CONSECUTIVE failed attempts in a
 *   row, later attempts are refused locally. It only stops calling THAT
 *   provider; there is no fallback to another provider.
 * - CallBudget, shared by a whole bake-off: refuses attempts beyond
 *   --max-calls or once the estimated cost reaches --max-cost-usd.
 *
 * Nothing here records a prompt, a response, an image or a key.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type { AiPrice } from '../../src/lib/ai/config'
import { AiProviderError, isAiProviderError } from '../../src/lib/ai/providers/errors'
import { MAX_RETRIES, RetriedError, withRetry } from '../../src/lib/ai/providers/retry'
import type { LLMProvider, LLMRequest, VisionProvider, VisionRequest } from '../../src/lib/ai/providers/types'
import { estimateCostUsd } from '../../src/lib/ai/telemetry'
import type { EvalProviderName } from './eval-common'

export const CIRCUIT_MAX_FATAL = 2
export const CIRCUIT_MAX_CONSECUTIVE = 5
/** A section may not hold more cases than this (a guard against an unexpectedly large dataset). */
export const MAX_CASES_PER_SECTION = 500
const FATAL = new Set(['auth', 'config', 'invalid_request'])

export type LiveFeature = 'vision' | 'stylist' | 'outfit'
export const COST_UNAVAILABLE = 'COST_UNAVAILABLE'
export type Cost = number | typeof COST_UNAVAILABLE

/** Why an attempt was refused locally. */
export type SkipReason = 'circuit_break' | 'budget_stop'

/**
 * An attempt refused locally (circuit open or budget exhausted): never a
 * provider call. It is a `cancelled` provider error (not retryable), so the
 * app's code paths treat it like any failure; the runners exclude it from
 * their call count.
 */
export class LocalRefusalError extends AiProviderError {
  constructor(
    provider: string,
    readonly reason: SkipReason,
  ) {
    super('cancelled', provider)
    this.name = 'LocalRefusalError'
  }
}

/** Shared by a whole bake-off: the hard limits on real provider calls and estimated cost. */
export class CallBudget {
  attemptsUsed = 0
  costSpentUsd = 0
  /** Attempts that reported tokens but had no price (cost then unknown). */
  unpricedAttempts = 0
  exhausted: 'max_calls' | 'max_cost' | null = null

  constructor(
    readonly maxCalls: number | null,
    readonly maxCostUsd: number | null,
  ) {}

  /** Reserves one attempt; false (nothing reserved) when a limit is reached. */
  take(): boolean {
    if (this.exhausted) return false
    if (this.maxCalls !== null && this.attemptsUsed >= this.maxCalls) {
      this.exhausted = 'max_calls'
      return false
    }
    this.attemptsUsed++
    return true
  }

  spend(usd: number | undefined): void {
    if (usd === undefined) {
      this.unpricedAttempts++
      return
    }
    this.costSpentUsd = Math.round((this.costSpentUsd + usd) * 1e6) / 1e6
    if (this.maxCostUsd !== null && this.costSpentUsd >= this.maxCostUsd) this.exhausted ??= 'max_cost'
  }
}

export class CallLedger {
  attempts = 0
  /** Attempts that followed a retryable failure of the same request (the app's single retry). */
  retries = 0
  timeouts = 0
  /** Attempts refused locally (never a provider call), by reason. */
  readonly skipped: Record<SkipReason, number> = { circuit_break: 0, budget_stop: 0 }
  inputTokens = 0
  outputTokens = 0
  /** Attempts that reported token usage. */
  usageReports = 0
  readonly attemptErrors: Record<string, number> = {}
  /** Null while closed; the error kind that opened it. */
  circuitOpen: string | null = null
  private fatal = 0
  private consecutive = 0
  private lastSkip: SkipReason | null = null
  private caseAttempts = 0
  /** The previous attempt of this case failed with a retryable kind: the next one is its retry. */
  private pendingRetry = false

  constructor(
    private readonly budget: CallBudget | null = null,
    private readonly price: AiPrice | null = null,
  ) {}

  /** Before every attempt: throws locally (no provider call) when the circuit is open or the budget is exhausted. */
  before(provider: string): void {
    const skip: SkipReason | null = this.circuitOpen ? 'circuit_break' : this.budget && !this.budget.take() ? 'budget_stop' : null
    const retry = this.pendingRetry
    this.pendingRetry = false
    if (skip) {
      this.skipped[skip]++
      this.lastSkip = skip
      throw new LocalRefusalError(provider, skip)
    }
    this.attempts++
    this.caseAttempts++
    if (retry) this.retries++
  }

  ok(usage: { inputTokens?: number; outputTokens?: number } | undefined): void {
    this.consecutive = 0
    if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
      this.usageReports++
      this.inputTokens += usage.inputTokens ?? 0
      this.outputTokens += usage.outputTokens ?? 0
      this.budget?.spend(estimateCostUsd(usage, this.price))
    }
  }

  fail(err: unknown): void {
    const kind = isAiProviderError(err) ? err.kind : 'unexpected'
    this.pendingRetry = isAiProviderError(err) && err.retryable
    this.attemptErrors[kind] = (this.attemptErrors[kind] ?? 0) + 1
    if (kind === 'timeout') this.timeouts++
    this.consecutive++
    if (FATAL.has(kind)) this.fatal++
    if (this.fatal >= CIRCUIT_MAX_FATAL || this.consecutive >= CIRCUIT_MAX_CONSECUTIVE) this.circuitOpen ??= kind
  }

  /**
   * Closes the case that just ended: the local refusal behind it (if any) and
   * how many real attempts it made. Resets the per-case state, so a retry is
   * never carried into the next case.
   */
  endCase(): { skip: SkipReason | null; attempts: number } {
    const r = { skip: this.lastSkip, attempts: this.caseAttempts }
    this.lastSkip = null
    this.caseAttempts = 0
    this.pendingRetry = false
    return r
  }
}

async function counted<T extends { metadata: { usage: { inputTokens?: number; outputTokens?: number } } }>(ledger: CallLedger, provider: string, attempt: () => Promise<T>): Promise<T> {
  ledger.before(provider)
  try {
    const result = await attempt()
    ledger.ok(result.metadata.usage)
    return result
  } catch (err) {
    ledger.fail(err)
    throw err
  }
}

/**
 * An LLM provider whose every attempt is counted. It does NOT retry: the text
 * runners apply the app's retry policy (withRetry, as client.ts does), so
 * there is exactly one retry layer.
 */
export function countedLLM(inner: LLMProvider, ledger: CallLedger): LLMProvider {
  return { name: inner.name, model: inner.model, generate: (req: LLMRequest) => counted(ledger, inner.name, () => inner.generate(req)) }
}

/**
 * A vision provider with the app's retry policy (withRetry, as client.ts:
 * at most one retry, transient kinds only) and every attempt counted. The
 * vision runner (vision-eval.ts runOne) does not retry, so there is exactly
 * one retry layer. The last provider error is rethrown as is.
 */
export function retryingVision(inner: VisionProvider, ledger: CallLedger, sleep?: (ms: number) => Promise<void>): VisionProvider {
  return {
    name: inner.name,
    model: inner.model,
    async analyzeImage(req: VisionRequest) {
      try {
        return (await withRetry(() => counted(ledger, inner.name, () => inner.analyzeImage(req)), { sleep })).value
      } catch (err) {
        throw err instanceof RetriedError ? err.lastError : err
      }
    },
  }
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** Nearest-rank percentile; null when there are fewer samples than the percentile needs to mean anything. */
export function latencyPercentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  // p99 needs at least 100 samples, p95 at least 20; below that the tail is the maximum, not a percentile.
  const min = p >= 99 ? 100 : p >= 95 ? 20 : 1
  if (v.length < min) return null
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]
}

export interface LatencyStats {
  n: number
  p50: number | null
  p95: number | null
  p99: number | null
  max: number | null
}

export function latencyStats(values: readonly number[]): LatencyStats {
  return { n: values.length, p50: latencyPercentile(values, 50), p95: latencyPercentile(values, 95), p99: latencyPercentile(values, 99), max: values.length ? Math.max(...values) : null }
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10_000) / 10_000)

// ─── Accounting of one live section ─────────────────────────────────────────

/** How one case ended. */
export type CaseStatus = 'success' | 'invalid_output' | 'provider_error' | SkipReason

export interface CaseResult {
  latencyMs: number
  requests: number
  status: CaseStatus
  /** Provider error kind, for provider_error. */
  errorKind: string | null
}

/**
 * Classifies a case from its outcome and endCase(). A `cancelled` error is a
 * local refusal (the harness never cancels otherwise): with no real attempt
 * the case is circuit_break / budget_stop (not attempted); after a real
 * attempt it is a provider_error whose kind is the refusal reason.
 */
export function caseResult(latencyMs: number, requests: number, outcome: { kind: string; error?: string }, end: { skip: SkipReason | null; attempts: number }): CaseResult {
  if (outcome.kind === 'error') {
    if (outcome.error === 'cancelled' && end.skip) {
      return end.attempts === 0 ? { latencyMs, requests: 0, status: end.skip, errorKind: null } : { latencyMs, requests, status: 'provider_error', errorKind: end.skip }
    }
    return { latencyMs, requests, status: 'provider_error', errorKind: outcome.error ?? 'unexpected' }
  }
  return { latencyMs, requests, status: outcome.kind === 'invalid' ? 'invalid_output' : 'success', errorKind: null }
}

export interface SectionAccounting {
  feature: LiveFeature
  cases: number
  /** Cases that reached the provider at least once (excludes circuit-broken and budget-stopped cases). */
  attemptedCases: number
  successfulCases: number
  /** The provider answered but the output broke the contract (after the correction, where there is one). */
  invalidOutputCases: number
  providerErrorCases: number
  circuitBreakCases: number
  budgetStopCases: number
  /** Logical requests that reached the provider (vision: one per image; text: first + corrections). */
  requests: number
  /** Correction requests issued (text only): requests − attempted cases. */
  corrections: number
  /** Real provider API calls: initial, retries and corrections; failed and timed-out ones included. */
  attempts: number
  /** Extra attempts after a retryable failure of the same request (counted at the call, not derived). */
  retries: number
  timeouts: number
  /** Error kind → failed attempts. */
  attemptErrors: Record<string, number>
  /** Error kind → cases that ended in a provider error. */
  caseErrors: Record<string, number>
  /** Attempts refused locally, by reason (never provider calls). */
  skippedAttempts: Record<SkipReason, number>
  circuitOpen: string | null
  /** successfulCases / attemptedCases (null when nothing was attempted; never 0 by default). */
  successRate: number | null
  /** (invalidOutputCases + providerErrorCases) / attemptedCases. */
  failureRate: number | null
  /** timeouts / attempts. */
  timeoutRate: number | null
  /** Measured latency of the attempted cases. */
  latencyMs: LatencyStats
  /** Per attempted case, for pooling across runs (numbers only). */
  latenciesMs: number[]
  tokens: { input: number; output: number; total: number; attemptsReporting: number }
  /** USD from the configured price and the reported tokens; COST_UNAVAILABLE without either. */
  costUsd: Cost
  price: { source: string; inputUsdPerMTok: number; outputUsdPerMTok: number; verified: false } | null
}

export function accountSection(feature: LiveFeature, ledger: CallLedger, cases: CaseResult[], price: AiPrice | null, priceSource: string | null = null): SectionAccounting {
  const attempted = cases.filter((c) => c.status !== 'circuit_break' && c.status !== 'budget_stop')
  const count = (s: CaseStatus) => cases.filter((c) => c.status === s).length
  const caseErrors: Record<string, number> = {}
  for (const c of cases) if (c.status === 'provider_error') caseErrors[c.errorKind!] = (caseErrors[c.errorKind!] ?? 0) + 1
  const requests = attempted.reduce((n, c) => n + c.requests, 0)
  const latencies = attempted.map((c) => c.latencyMs)
  const cost = ledger.usageReports > 0 ? estimateCostUsd({ inputTokens: ledger.inputTokens, outputTokens: ledger.outputTokens }, price) : undefined
  const failed = count('invalid_output') + count('provider_error')
  return {
    feature,
    cases: cases.length,
    attemptedCases: attempted.length,
    successfulCases: count('success'),
    invalidOutputCases: count('invalid_output'),
    providerErrorCases: count('provider_error'),
    circuitBreakCases: count('circuit_break'),
    budgetStopCases: count('budget_stop'),
    requests,
    corrections: requests - attempted.length,
    attempts: ledger.attempts,
    retries: ledger.retries,
    timeouts: ledger.timeouts,
    attemptErrors: sortKeys(ledger.attemptErrors),
    caseErrors: sortKeys(caseErrors),
    skippedAttempts: { ...ledger.skipped },
    circuitOpen: ledger.circuitOpen,
    successRate: ratio(count('success'), attempted.length),
    failureRate: ratio(failed, attempted.length),
    timeoutRate: ratio(ledger.timeouts, ledger.attempts),
    latencyMs: latencyStats(latencies),
    latenciesMs: latencies,
    tokens: { input: ledger.inputTokens, output: ledger.outputTokens, total: ledger.inputTokens + ledger.outputTokens, attemptsReporting: ledger.usageReports },
    costUsd: cost ?? COST_UNAVAILABLE,
    price: price ? { source: priceSource ?? 'configured', ...price, verified: false } : null,
  }
}

const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

// ─── Call budget ────────────────────────────────────────────────────────────

/** Provider calls one case can cost at most: vision 1 request; text a first request plus one correction; each with one retry. */
export const MAX_CALLS_PER_CASE: Record<LiveFeature, number> = {
  vision: 1 + MAX_RETRIES,
  stylist: 2 * (1 + MAX_RETRIES),
  outfit: 2 * (1 + MAX_RETRIES),
}

export interface CallPlan {
  runs: number
  sections: Array<{ provider: EvalProviderName; feature: LiveFeature; cases: number; upperBoundCalls: number }>
  /** Σ cases × MAX_CALLS_PER_CASE × runs, over every runnable provider × feature. */
  upperBoundCalls: number
  /** --max-calls / AI_EVAL_MAX_CALLS, or null (no cap configured). */
  maxCalls: number | null
  /** --max-cost-usd / AI_EVAL_MAX_COST_USD, or null. */
  maxCostUsd: number | null
}

export function planCalls(sections: Array<{ provider: EvalProviderName; feature: LiveFeature; cases: number }>, runs: number, maxCalls: number | null, maxCostUsd: number | null = null): CallPlan {
  const withBound = sections.map((s) => ({ ...s, upperBoundCalls: s.cases * MAX_CALLS_PER_CASE[s.feature] * runs }))
  return { runs, sections: withBound, upperBoundCalls: withBound.reduce((n, s) => n + s.upperBoundCalls, 0), maxCalls, maxCostUsd }
}

/** Refuses, before any provider call, a plan above the call cap or with an oversized section. */
export function assertWithinCap(plan: CallPlan): void {
  const big = plan.sections.find((s) => s.cases > MAX_CASES_PER_SECTION)
  if (big) throw new Error(`the ${big.feature} dataset has ${big.cases} cases, above the limit of ${MAX_CASES_PER_SECTION} per section`)
  if (plan.maxCalls !== null && plan.upperBoundCalls > plan.maxCalls) {
    throw new Error(`the live bake-off could make up to ${plan.upperBoundCalls} provider calls, above the cap of ${plan.maxCalls} (--max-calls); reduce --runs or the dataset`)
  }
}

/** The CLI never runs a live section without an explicit call cap. */
export function assertCapForLive(plan: CallPlan): void {
  if (plan.upperBoundCalls > 0 && plan.maxCalls === null) {
    throw new Error(`a live bake-off needs --max-calls (AI_EVAL_MAX_CALLS); this plan could make up to ${plan.upperBoundCalls} provider calls`)
  }
}

export function parseMaxCalls(raw: string | undefined): number | null {
  const v = raw?.trim()
  if (!v) return null
  if (!/^\d{1,6}$/.test(v) || Number(v) < 1) throw new Error('--max-calls (AI_EVAL_MAX_CALLS) must be a whole number ≥ 1')
  return Number(v)
}

export function parseMaxCost(raw: string | undefined): number | null {
  const v = raw?.trim()
  if (!v) return null
  const n = Number(v)
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(v) || !(n > 0)) throw new Error('--max-cost-usd (AI_EVAL_MAX_COST_USD) must be a positive amount')
  return n
}

// ─── Prices (existing variables) ────────────────────────────────────────────

/**
 * The configured price for `provider`'s text or vision model: the app's
 * AI_LLM_PRICE_* / AI_VISION_PRICE_* variables, used only when AI_LLM_PROVIDER /
 * AI_VISION_PROVIDER names that provider. Null otherwise: cost is then COST_UNAVAILABLE.
 */
export function configuredPrice(provider: EvalProviderName, role: 'llm' | 'vision', env: Record<string, string | undefined>): AiPrice | null {
  const prefix = role === 'llm' ? 'AI_LLM' : 'AI_VISION'
  if (env[`${prefix}_PROVIDER`]?.trim().toLowerCase() !== provider) return null
  const i = env[`${prefix}_PRICE_INPUT_USD_PER_MTOK`]?.trim(), o = env[`${prefix}_PRICE_OUTPUT_USD_PER_MTOK`]?.trim()
  if (!i && !o) return null
  const n = (raw: string | undefined) => {
    const v = Number(raw)
    if (!raw || !Number.isFinite(v) || v < 0) throw new Error(`${prefix}_PRICE_INPUT_USD_PER_MTOK and ${prefix}_PRICE_OUTPUT_USD_PER_MTOK must both be non-negative numbers`)
    return v
  }
  return { inputUsdPerMTok: n(i), outputUsdPerMTok: n(o) }
}

export const priceSource = (role: 'llm' | 'vision') => `${role === 'llm' ? 'AI_LLM' : 'AI_VISION'}_PRICE_*_USD_PER_MTOK (environment; not verified)`

// ─── Dataset identity ───────────────────────────────────────────────────────

export type DatasetKind = 'synthetic' | 'real' | 'unspecified'

export class DatasetIntegrityError extends Error {
  constructor() {
    super('DATASET_INTEGRITY_FAILURE: a frozen dataset changed during the bake-off')
    this.name = 'DatasetIntegrityError'
  }
}

export interface DatasetIdentity {
  name: string
  /** Where the frozen content lives (a directory for vision, the source file for case sets). */
  path: string
  version: string | null
  /** sha256 over the frozen content (labels and image bytes, or the case definitions). */
  sha256: string
  cases: number
  kind: DatasetKind
  /** Vision only: sha256 of every image, by file name (each image is re-checked right before it is sent). */
  files?: Record<string, string>
}

export const sha256Hex = (data: string | Uint8Array) => crypto.createHash('sha256').update(data).digest('hex')

/** Hash of a code-defined case set (stylist, outfit): its JSON. */
export function caseSetIdentity(name: string, file: string, version: string, cases: readonly unknown[]): DatasetIdentity {
  return { name, path: file, version, sha256: sha256Hex(JSON.stringify(cases)), cases: cases.length, kind: 'synthetic' }
}

/** Hash of a vision dataset directory: labels.json, then every listed image in order. */
export async function visionDatasetIdentity(dir: string, labels: { version?: string; kind?: 'synthetic' | 'real'; items: Array<{ id: string; file: string }> }): Promise<DatasetIdentity> {
  const h = crypto.createHash('sha256')
  h.update(await fs.readFile(path.join(dir, 'labels.json')))
  const files: Record<string, string> = {}
  for (const item of labels.items) {
    const bytes = await fs.readFile(path.join(dir, item.file))
    h.update(`\n${item.id}\n`)
    h.update(bytes)
    files[item.file] = sha256Hex(bytes)
  }
  const kind: DatasetKind = labels.kind ?? (labels.version?.startsWith('synthetic') ? 'synthetic' : 'unspecified')
  return { name: 'vision', path: dir, version: labels.version ?? null, sha256: h.digest('hex'), cases: labels.items.length, kind, files }
}
