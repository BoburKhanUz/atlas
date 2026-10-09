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
 *   --max-calls (a hard limit), and with --max-cost-usd reserves an estimated
 *   cost BEFORE every attempt (cost-bounds.ts) and refuses an attempt whose
 *   reservation does not fit. Failed attempts and attempts without complete
 *   usage keep their whole reservation; unknown cost is never zero. The text
 *   input part of an estimate is a heuristic, so the dollar budget limits
 *   spending risk but is not a guaranteed maximum charge.
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
import { costOf, estimateTextAttempt, estimateVisionAttempt, INPUT_ESTIMATE_STATUS, isBudgetablePrice, isSoundEstimate, roundUsd, type CostEstimate, type EstimateResult } from './cost-bounds'
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

/** Why the budget refuses every further attempt. */
export type BudgetStopReason =
  /** --max-calls reached. */
  | 'max_calls'
  /** The next attempt's reservation does not fit in what is left of --max-cost-usd. */
  | 'max_cost'
  /** A dollar budget is set, but the attempt's provider and exact model have no configured price. */
  | 'unpriced'
  /** A dollar budget is set, but the attempt has no estimate (no output-token limit, unsupported image setting…). */
  | 'unbounded'
  /** A dollar budget is set and an attempt's provider-reported cost exceeded its pre-request estimate. */
  | 'estimate_exceeded'

/** What one admitted attempt reserved; `cost` is null when no estimate was made (no price, no dollar budget). */
export interface Reservation {
  cost: CostEstimate | null
}

/** Running cost totals (USD) of a ledger or a whole budget. Never contains content. */
export class CostTotals {
  /** Attempts admitted with a cost estimate. */
  estimatedAttempts = 0
  reservedUsd = 0
  /** HEURISTIC_NOT_GUARANTEE part of the reservations. */
  estimatedTextInputUsd = 0
  /** Documented-formula part (OpenAI gpt-5.4 family images). */
  estimatedImageInputUsd = 0
  /** Documented output-limit part (reasoning / thinking included). */
  boundedOutputUsd = 0
  /** Exact-model price × provider-reported tokens, for attempts that reported complete usage. */
  providerReportedUsd = 0
  providerReportedAttempts = 0
  /** Reservations kept in full: failed attempts (timeouts, network, malformed…) and missing or partial usage. */
  retainedReservationUsd = 0
  retainedReservationAttempts = 0
  /** Attempts with neither a reported cost nor a reservation (no price): their cost is unknown, never zero. */
  unknownCostAttempts = 0
  /** Attempts whose provider-reported cost (or output tokens) exceeded their pre-request estimate. */
  estimateExceededAttempts = 0

  reserve(c: CostEstimate): void {
    this.estimatedAttempts++
    this.reservedUsd = roundUsd(this.reservedUsd + c.totalUsd)
    this.estimatedTextInputUsd = roundUsd(this.estimatedTextInputUsd + c.textInputUsd)
    this.estimatedImageInputUsd = roundUsd(this.estimatedImageInputUsd + c.imageInputUsd)
    this.boundedOutputUsd = roundUsd(this.boundedOutputUsd + c.outputUsd)
  }

  settle(reservation: Reservation, reportedUsd: number | undefined): void {
    if (reportedUsd !== undefined) {
      this.providerReportedAttempts++
      this.providerReportedUsd = roundUsd(this.providerReportedUsd + reportedUsd)
    } else if (reservation.cost) {
      this.retainedReservationAttempts++
      this.retainedReservationUsd = roundUsd(this.retainedReservationUsd + reservation.cost.totalUsd)
    } else this.unknownCostAttempts++
  }

  /** Provider-reported cost plus every retained reservation: what the run is assumed to have cost. */
  get chargedUsd(): number {
    return roundUsd(this.providerReportedUsd + this.retainedReservationUsd)
  }
}

/** The cost section of a report: estimates, provider-reported cost and unknowns kept apart. */
export interface CostAccounting {
  /** The text-input part of every estimate is a heuristic, never a proven bound. */
  inputEstimateStatus: typeof INPUT_ESTIMATE_STATUS
  estimatedAttempts: number
  reservedCostUsd: number
  estimatedInputCostUsd: number
  estimatedImageCostUsd: number
  boundedOutputCostUsd: number
  /** COST_UNAVAILABLE when no attempt reported complete usage with a price. */
  providerReportedCostUsd: Cost
  providerReportedAttempts: number
  retainedReservationUsd: number
  retainedReservationAttempts: number
  /** Provider-reported cost + retained reservations; COST_UNAVAILABLE when any attempt's cost is unknown. */
  conservativeCostUsd: Cost
  unpricedOrUnknownCostAttempts: number
  estimateExceededAttempts: number
  note: string
}

export const COST_ACCOUNTING_NOTE =
  'Reservations are estimates, not a guaranteed maximum charge: the text-input part is HEURISTIC_NOT_GUARANTEE, and provider-reported usage is unavailable for failed attempts (their full reservation is kept instead).'

export function costAccounting(t: CostTotals): CostAccounting {
  return {
    inputEstimateStatus: INPUT_ESTIMATE_STATUS,
    estimatedAttempts: t.estimatedAttempts,
    reservedCostUsd: t.reservedUsd,
    estimatedInputCostUsd: t.estimatedTextInputUsd,
    estimatedImageCostUsd: t.estimatedImageInputUsd,
    boundedOutputCostUsd: t.boundedOutputUsd,
    providerReportedCostUsd: t.providerReportedAttempts > 0 ? t.providerReportedUsd : COST_UNAVAILABLE,
    providerReportedAttempts: t.providerReportedAttempts,
    retainedReservationUsd: t.retainedReservationUsd,
    retainedReservationAttempts: t.retainedReservationAttempts,
    conservativeCostUsd: t.unknownCostAttempts > 0 || t.providerReportedAttempts + t.retainedReservationAttempts === 0 ? COST_UNAVAILABLE : t.chargedUsd,
    unpricedOrUnknownCostAttempts: t.unknownCostAttempts,
    estimateExceededAttempts: t.estimateExceededAttempts,
    note: COST_ACCOUNTING_NOTE,
  }
}

/**
 * Shared by a whole bake-off: the hard limit on real provider calls
 * (--max-calls) and the dollar budget (--max-cost-usd).
 *
 * admit() decides and reserves in one synchronous step, so two attempts in
 * flight can never both claim the same remaining budget (the harnesses are
 * sequential; this keeps it true if that changes). With a dollar budget an
 * attempt is refused unless it has an exact-model price and an estimate, and
 * unless charged + outstanding reservations + its estimate fit. The estimate is
 * not a guaranteed maximum charge (see cost-bounds.ts), so neither is the budget.
 */
export class CallBudget {
  attemptsUsed = 0
  /** Provider-reported cost (configured price × reported tokens), as before the reservations. */
  costSpentUsd = 0
  /** Attempts that reported tokens but had no price (cost then unknown). */
  unpricedAttempts = 0
  exhausted: BudgetStopReason | null = null
  /** Why the budget stopped, in a few words (no content); null while it has not. */
  stopDetail: string | null = null
  readonly cost = new CostTotals()
  /** Reservations of the attempts in flight. */
  private outstandingUsd = 0

  constructor(
    readonly maxCalls: number | null,
    readonly maxCostUsd: number | null,
  ) {}

  /** Reserves one attempt against --max-calls only; false (nothing reserved) when a limit is reached. */
  take(): boolean {
    if (this.exhausted) return false
    if (this.maxCalls !== null && this.attemptsUsed >= this.maxCalls) {
      this.stop('max_calls', '--max-calls reached')
      return false
    }
    this.attemptsUsed++
    return true
  }

  /**
   * Admits one attempt (its reservation) or refuses it (null; nothing is
   * reserved or counted). `estimate`: the attempt's cost estimate, the reason
   * there is none, or null when there is no price.
   */
  admit(estimate: CostEstimate | { unavailable: string } | null): Reservation | null {
    if (this.exhausted) return null
    if (this.maxCostUsd !== null) {
      if (estimate === null) return this.stop('unpriced', 'no usable price (both rates above zero) for this provider and exact model')
      if ('unavailable' in estimate) return this.stop('unbounded', estimate.unavailable)
      if (!isSoundEstimate(estimate)) return this.stop('unbounded', 'the estimate is not a finite, non-negative amount')
      if (roundUsd(this.cost.chargedUsd + this.outstandingUsd + estimate.totalUsd) > this.maxCostUsd) {
        return this.stop('max_cost', "the next attempt's reservation does not fit in the remaining --max-cost-usd")
      }
    }
    if (!this.take()) return null
    const cost = estimate && !('unavailable' in estimate) && isSoundEstimate(estimate) ? estimate : null
    if (cost) {
      this.outstandingUsd = roundUsd(this.outstandingUsd + cost.totalUsd)
      this.cost.reserve(cost)
    }
    return { cost }
  }

  /** Closes an admitted attempt: the provider-reported cost when known, else its whole reservation. */
  settle(reservation: Reservation, reportedUsd: number | undefined, exceeded: boolean): void {
    if (reservation.cost) this.outstandingUsd = roundUsd(Math.max(0, this.outstandingUsd - reservation.cost.totalUsd))
    this.cost.settle(reservation, reportedUsd)
    if (exceeded) {
      this.cost.estimateExceededAttempts++
      if (this.maxCostUsd !== null) this.stop('estimate_exceeded', "an attempt's provider-reported cost exceeded its pre-request estimate")
    }
    if (this.maxCostUsd !== null && this.cost.chargedUsd >= this.maxCostUsd) this.stop('max_cost', '--max-cost-usd reached')
  }

  spend(usd: number | undefined): void {
    if (usd === undefined) {
      this.unpricedAttempts++
      return
    }
    this.costSpentUsd = Math.round((this.costSpentUsd + usd) * 1e6) / 1e6
  }

  private stop(reason: BudgetStopReason, detail: string): null {
    if (!this.exhausted) {
      this.exhausted = reason
      this.stopDetail = detail
    }
    return null
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
  /** This ledger's share of the cost totals. */
  readonly cost = new CostTotals()
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
    /** The configured price of THIS ledger's provider and exact model (configuredPrice), or null. */
    private readonly price: AiPrice | null = null,
  ) {}

  /** An estimate is worth computing: there is a price to turn it into dollars, or a dollar budget that needs one. */
  get wantsEstimate(): boolean {
    return this.price !== null || (this.budget?.maxCostUsd ?? null) !== null
  }

  /**
   * Before every attempt, synchronously: throws locally (no provider call) when
   * the circuit is open or the budget refuses; otherwise returns the attempt's
   * reservation. `estimate` is undefined when the call site provides none.
   */
  before(provider: string, estimate?: EstimateResult): Reservation {
    // With a dollar budget only a price with both rates above zero counts; a zero rate would reserve nothing.
    const price = this.budget?.maxCostUsd != null ? (isBudgetablePrice(this.price) ? this.price : null) : this.price
    const cost = !price ? null : !estimate ? { unavailable: 'no estimate for this request' } : estimate.ok ? costOf(estimate.tokens, price) : { unavailable: estimate.reason }
    let reservation: Reservation | null = null
    let skip: SkipReason | null = null
    if (this.circuitOpen) skip = 'circuit_break'
    else if (this.budget) {
      reservation = this.budget.admit(cost)
      if (!reservation) skip = 'budget_stop'
    } else reservation = { cost: cost && !('unavailable' in cost) && isSoundEstimate(cost) ? cost : null }
    const retry = this.pendingRetry
    this.pendingRetry = false
    if (skip || !reservation) {
      this.skipped[skip ?? 'budget_stop']++
      this.lastSkip = skip ?? 'budget_stop'
      throw new LocalRefusalError(provider, skip ?? 'budget_stop')
    }
    if (reservation.cost) this.cost.reserve(reservation.cost)
    this.attempts++
    this.caseAttempts++
    if (retry) this.retries++
    return reservation
  }

  ok(usage: { inputTokens?: number; outputTokens?: number } | undefined, reservation: Reservation = { cost: null }): void {
    this.consecutive = 0
    if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
      this.usageReports++
      this.inputTokens += usage.inputTokens ?? 0
      this.outputTokens += usage.outputTokens ?? 0
      this.budget?.spend(estimateCostUsd(usage, this.price))
    }
    // Only complete usage gives a provider-reported cost; partial or missing usage keeps the whole reservation.
    const reported = estimateCostUsd(usage, this.price)
    const exceeded = !!reservation.cost && reported !== undefined && (reported > reservation.cost.totalUsd || (usage?.outputTokens ?? 0) > reservation.cost.tokens.outputTokens)
    this.settle(reservation, reported, exceeded)
  }

  fail(err: unknown, reservation: Reservation = { cost: null }): void {
    const kind = isAiProviderError(err) ? err.kind : 'unexpected'
    this.pendingRetry = isAiProviderError(err) && err.retryable
    this.attemptErrors[kind] = (this.attemptErrors[kind] ?? 0) + 1
    if (kind === 'timeout') this.timeouts++
    this.consecutive++
    if (FATAL.has(kind)) this.fatal++
    if (this.fatal >= CIRCUIT_MAX_FATAL || this.consecutive >= CIRCUIT_MAX_CONSECUTIVE) this.circuitOpen ??= kind
    // A failed attempt may still be billed and reports no usage: its whole reservation is kept.
    this.settle(reservation, undefined, false)
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

  private settle(reservation: Reservation, reportedUsd: number | undefined, exceeded: boolean): void {
    this.cost.settle(reservation, reportedUsd)
    if (exceeded) this.cost.estimateExceededAttempts++
    this.budget?.settle(reservation, reportedUsd, exceeded)
  }
}

/**
 * One counted attempt: the estimate (when it matters) and the reservation come
 * BEFORE the request is dispatched; the settlement after it.
 */
async function counted<T extends { metadata: { usage: { inputTokens?: number; outputTokens?: number } } }>(
  ledger: CallLedger,
  provider: string,
  attempt: () => Promise<T>,
  estimate?: () => EstimateResult | Promise<EstimateResult>,
): Promise<T> {
  const est = estimate && ledger.wantsEstimate ? await estimate() : undefined
  const reservation = ledger.before(provider, est)
  try {
    const result = await attempt()
    ledger.ok(result.metadata.usage, reservation)
    return result
  } catch (err) {
    ledger.fail(err, reservation)
    throw err
  }
}

/**
 * An LLM provider whose every attempt is estimated, reserved and counted. It
 * does NOT retry: the text runners apply the app's retry policy (withRetry, as
 * client.ts does), so there is exactly one retry layer and every retry and
 * correction is its own attempt with its own reservation.
 */
export function countedLLM(inner: LLMProvider, ledger: CallLedger): LLMProvider {
  return { name: inner.name, model: inner.model, generate: (req: LLMRequest) => counted(ledger, inner.name, () => inner.generate(req), () => estimateTextAttempt(req)) }
}

/**
 * A vision provider with the app's retry policy (withRetry, as client.ts:
 * at most one retry, transient kinds only) and every attempt estimated,
 * reserved and counted. The vision runner (vision-eval.ts runOne) does not
 * retry, so there is exactly one retry layer. The last provider error is
 * rethrown as is.
 */
export function retryingVision(inner: VisionProvider, ledger: CallLedger, sleep?: (ms: number) => Promise<void>): VisionProvider {
  return {
    name: inner.name,
    model: inner.model,
    async analyzeImage(req: VisionRequest) {
      try {
        return (await withRetry(() => counted(ledger, inner.name, () => inner.analyzeImage(req), () => estimateVisionAttempt(inner.name, inner.model, req)), { sleep })).value
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
  /** Pre-request reservations vs provider-reported cost (estimates are not a guaranteed maximum charge). */
  costAccounting: CostAccounting
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
    costAccounting: costAccounting(ledger.cost),
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
 * The configured price of `provider`'s exact `model` for text or vision: the
 * app's AI_LLM_PRICE_* / AI_VISION_PRICE_* variables, used only when
 * AI_LLM_PROVIDER / AI_VISION_PROVIDER names that provider AND AI_LLM_MODEL /
 * AI_VISION_MODEL names exactly that model. A price is never reused for another
 * model of the same provider. Null otherwise: cost is then COST_UNAVAILABLE, and
 * a dollar budget refuses the attempt.
 */
export function configuredPrice(provider: EvalProviderName, model: string | null, role: 'llm' | 'vision', env: Record<string, string | undefined>): AiPrice | null {
  const prefix = role === 'llm' ? 'AI_LLM' : 'AI_VISION'
  if (env[`${prefix}_PROVIDER`]?.trim().toLowerCase() !== provider) return null
  if (!model || env[`${prefix}_MODEL`]?.trim() !== model) return null
  const i = env[`${prefix}_PRICE_INPUT_USD_PER_MTOK`]?.trim(), o = env[`${prefix}_PRICE_OUTPUT_USD_PER_MTOK`]?.trim()
  if (!i && !o) return null
  const n = (raw: string | undefined) => {
    const v = Number(raw)
    if (!raw || !Number.isFinite(v) || v < 0) throw new Error(`${prefix}_PRICE_INPUT_USD_PER_MTOK and ${prefix}_PRICE_OUTPUT_USD_PER_MTOK must both be non-negative numbers`)
    return v
  }
  return { inputUsdPerMTok: n(i), outputUsdPerMTok: n(o) }
}

export const priceSource = (role: 'llm' | 'vision') => {
  const prefix = role === 'llm' ? 'AI_LLM' : 'AI_VISION'
  return `${prefix}_PRICE_*_USD_PER_MTOK for ${prefix}_PROVIDER + exact ${prefix}_MODEL (environment; not verified)`
}

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
