/**
 * Phase 5.1 accounting gate: every provider attempt, retry, timeout, failure,
 * correction, circuit break, budget stop, token and cost is counted exactly
 * once, through the same runner code the bake-off uses. Deterministic:
 * scripted providers, no network, no keys (fake key values only).
 */
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bakeoffMarkdown, buildBakeoff, DATASET_INTEGRITY_FAILURE } from '../../../scripts/ai-eval/bakeoff'
import {
  accountSection,
  assertCapForLive,
  CallBudget,
  CallLedger,
  caseResult,
  CIRCUIT_MAX_CONSECUTIVE,
  CIRCUIT_MAX_FATAL,
  countedLLM,
  parseMaxCost,
  planCalls,
  retryingVision,
  type CaseResult,
} from '../../../scripts/ai-eval/live-accounting'
import { outfitCases } from '../../../scripts/ai-eval/outfit-cases'
import { runOutfitCase, ScriptedOutfit } from '../../../scripts/ai-eval/outfit-eval'
import { stylistCases } from '../../../scripts/ai-eval/stylist-cases'
import { runStylistCase, ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../../scripts/ai-eval/synthetic-vision'
import { evaluateVisionConfig } from '../../../scripts/ai-eval/vision-eval'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import { AiProviderError, type AiErrorKind } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest, VisionProvider } from '@/lib/ai/providers/types'

const FAKE = 'fake-key-not-real-51acc'
const noSleep = async () => {}
const CASE = stylistCases().find((c) => c.id === 'casual')!
const usage = { inputTokens: 1000, outputTokens: 100 }

type Step = 'ok' | 'bad_ref' | 'not_json' | AiErrorKind | Error
/** A text provider that plays `steps` in order (the last step repeats); `calls` counts real invocations. */
function llm(steps: Step[]): LLMProvider & { calls: number } {
  const good = new ScriptedStylist()
  const p = {
    name: 'scripted',
    model: 'm',
    calls: 0,
    async generate(req: LLMRequest) {
      const step = steps[Math.min(p.calls++, steps.length - 1)]
      if (step instanceof Error) throw step
      if (step !== 'ok' && step !== 'bad_ref' && step !== 'not_json') throw new AiProviderError(step, 'scripted', step === 'auth' ? { status: 401 } : {})
      if (step === 'not_json') return { text: 'Sorry, here is some prose instead of JSON.', metadata: { provider: 'scripted', model: 'm', usage } }
      const out = JSON.parse((await good.generate(req)).text)
      if (step === 'bad_ref') out.referencedItems = ['W999']
      return { text: JSON.stringify(out), metadata: { provider: 'scripted', model: 'm', usage } }
    },
  }
  return p
}

/** One stylist case through the bake-off's own path: counted provider → runner (app retry policy) → classification → accounting. */
async function stylistOnce(steps: Step[], ledger = new CallLedger()) {
  const inner = llm(steps)
  const record = await runStylistCase(countedLLM(inner, ledger), CASE)
  const result = caseResult(record.latencyMs, record.requests, record.outcome, ledger.endCase())
  return { inner, record, result, acc: accountSection('stylist', ledger, [result], null), ledger }
}

describe('accounting: the ten required cases (stylist runner, exact counts)', () => {
  it('1. success on the first attempt', async () => {
    const { inner, record, acc } = await stylistOnce(['ok'])
    expect([inner.calls, record.calls, record.requests]).toEqual([1, 1, 1])
    expect(acc).toMatchObject({ attempts: 1, requests: 1, retries: 0, corrections: 0, timeouts: 0, attemptErrors: {}, caseErrors: {}, successfulCases: 1, attemptedCases: 1, successRate: 1, failureRate: 0, timeoutRate: 0 })
    expect(acc.tokens).toEqual({ input: 1000, output: 100, total: 1100, attemptsReporting: 1 })
  })

  it('2. failure on the first attempt (503), success on the retry: both attempts counted', async () => {
    const { inner, record, acc } = await stylistOnce(['unavailable', 'ok'])
    expect([inner.calls, record.calls, record.requests]).toEqual([2, 2, 1])
    expect(acc).toMatchObject({ attempts: 2, requests: 1, retries: 1, attemptErrors: { unavailable: 1 }, caseErrors: {}, successfulCases: 1, successRate: 1 })
    expect(acc.tokens.attemptsReporting).toBe(1) // only the successful attempt reported usage
  })

  it('3. failure on both attempts: the failed retry is counted; one final failure', async () => {
    const { inner, record, result, acc } = await stylistOnce(['unavailable', 'unavailable', 'ok'])
    expect([inner.calls, record.calls, record.requests]).toEqual([2, 2, 1])
    expect(result).toMatchObject({ status: 'provider_error', errorKind: 'unavailable' })
    expect(acc).toMatchObject({ attempts: 2, retries: 1, attemptErrors: { unavailable: 2 }, caseErrors: { unavailable: 1 }, providerErrorCases: 1, successRate: 0, failureRate: 1 })
  })

  it('4. timeout on the first attempt, success on the retry', async () => {
    const { record, acc } = await stylistOnce(['timeout', 'ok'])
    expect(record.calls).toBe(2)
    expect(acc).toMatchObject({ attempts: 2, retries: 1, timeouts: 1, attemptErrors: { timeout: 1 }, caseErrors: {}, successRate: 1, timeoutRate: 0.5 })
  })

  it('5. timeout on both attempts: two timed-out attempts, one final timeout', async () => {
    const { record, acc } = await stylistOnce(['timeout', 'timeout', 'ok'])
    expect(record.calls).toBe(2)
    expect(acc).toMatchObject({ attempts: 2, retries: 1, timeouts: 2, attemptErrors: { timeout: 2 }, caseErrors: { timeout: 1 }, failureRate: 1, timeoutRate: 1 })
  })

  it('6. circuit already open before the call: no provider call, not an attempt, a separate status, no rate', async () => {
    const ledger = new CallLedger()
    for (let i = 0; i < CIRCUIT_MAX_FATAL; i++) {
      ledger.before('scripted')
      ledger.fail(new AiProviderError('auth', 'scripted', { status: 401 }))
    }
    ledger.endCase()
    const fresh = new CallLedger()
    Object.assign(fresh, { circuitOpen: ledger.circuitOpen })
    const { inner, result, acc } = await stylistOnce(['ok'], fresh)
    expect(inner.calls).toBe(0)
    expect(result).toEqual({ latencyMs: result.latencyMs, requests: 0, status: 'circuit_break', errorKind: null })
    expect(acc).toMatchObject({ attempts: 0, requests: 0, retries: 0, attemptedCases: 0, circuitBreakCases: 1, providerErrorCases: 0, skippedAttempts: { circuit_break: 1, budget_stop: 0 } })
    expect([acc.successRate, acc.failureRate, acc.timeoutRate]).toEqual([null, null, null]) // never 0, never success
    expect(acc.latencyMs.n).toBe(0) // a refused case has no provider latency
  })

  it('7. circuit opens after N failures: later cases are not called', async () => {
    const ledger = new CallLedger()
    const inner = llm(['auth'])
    const p = countedLLM(inner, ledger)
    const results: CaseResult[] = []
    for (let i = 0; i < 4; i++) {
      const r = await runStylistCase(p, CASE)
      results.push(caseResult(r.latencyMs, r.requests, r.outcome, ledger.endCase()))
    }
    expect(inner.calls).toBe(CIRCUIT_MAX_FATAL) // auth is never retried
    expect(results.map((r) => r.status)).toEqual(['provider_error', 'provider_error', 'circuit_break', 'circuit_break'])
    const acc = accountSection('stylist', ledger, results, null)
    expect(acc).toMatchObject({ attempts: 2, retries: 0, circuitOpen: 'auth', attemptedCases: 2, circuitBreakCases: 2, caseErrors: { auth: 2 }, failureRate: 1 })
  })

  it('8. mixed success and failure across runs: each run has its own counters and circuit (no leakage)', async () => {
    let run = 0
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g' }
    // Run 1 fails (auth), run 2 is healthy: run 2 must not inherit run 1's open circuit.
    const r = await buildBakeoff(env, { runs: 2, providers: { llm: () => (++run === 1 ? llm(['auth']) : llm(['ok'])) } })
    const st = (i: number) => r.runs![i].live[0].accounting.find((a) => a.feature === 'stylist')!
    expect([st(0).circuitOpen, st(0).attempts, st(0).successRate]).toEqual(['auth', CIRCUIT_MAX_FATAL, 0])
    expect([st(1).circuitOpen, st(1).attemptErrors, st(1).successRate]).toEqual([null, {}, 1])
    expect(st(1).attempts).toBe(st(1).requests)
    const agg = r.aggregate!.find((a) => a.provider === 'gemini' && a.feature === 'stylist')!
    expect(agg.testedRuns).toBe(2)
  })

  it('9. provider unavailable (network): retried once, then a final provider error', async () => {
    const { record, acc } = await stylistOnce(['network', 'network'])
    expect(record.calls).toBe(2)
    expect(acc).toMatchObject({ attempts: 2, retries: 1, attemptErrors: { network: 2 }, caseErrors: { network: 1 } })
  })

  it('10. malformed provider response: a 2xx with prose is an application-level invalid output (provider answered, not retried, no circuit); a malformed_response error is a provider failure, not retried', async () => {
    const prose = await stylistOnce(['not_json'])
    expect(prose.record.calls).toBe(1)
    expect(prose.result.status).toBe('invalid_output')
    expect(prose.acc).toMatchObject({ attempts: 1, retries: 0, attemptErrors: {}, invalidOutputCases: 1, providerErrorCases: 0, failureRate: 1 })
    const thrown = await stylistOnce(['malformed_response', 'ok'])
    expect(thrown.record.calls).toBe(1)
    expect(thrown.acc).toMatchObject({ attempts: 1, retries: 0, attemptErrors: { malformed_response: 1 }, caseErrors: { malformed_response: 1 } })
  })
})

/** A scripted outfit provider: 'ok' ranks like the engine, 'bad' returns an invalid ranking (forces the correction). */
function outfitLlm(steps: Array<'ok' | 'bad' | AiErrorKind>): LLMProvider & { calls: number } {
  const good = new ScriptedOutfit()
  const p = {
    name: 'scripted', model: 'm', calls: 0,
    async generate(req: LLMRequest) {
      const step = steps[Math.min(p.calls++, steps.length - 1)]
      if (step === 'bad') return { text: JSON.stringify({ selectedCandidate: 'O99', ranking: ['O99'], explanation: 'x', needsMoreInfo: false }), metadata: { provider: 'scripted', model: 'm', usage } }
      if (step !== 'ok') throw new AiProviderError(step, 'scripted')
      return { ...(await good.generate(req)), metadata: { provider: 'scripted', model: 'm', usage } }
    },
  }
  return p
}
const OUTFIT = outfitCases()[0]
async function outfitOnce(steps: Array<'ok' | 'bad' | AiErrorKind>, ledger = new CallLedger()) {
  const inner = outfitLlm(steps)
  const record = await runOutfitCase(countedLLM(inner, ledger), OUTFIT)
  const result = caseResult(record.latencyMs, record.requests, record.outcome, ledger.endCase())
  return { inner, record, result, acc: accountSection('outfit', ledger, [result], null) }
}

describe('outfit runner accounting', () => {
  it('failure on both attempts: the failed attempts are in record.calls; one request; the deterministic fallback stays', async () => {
    const { inner, record, result, acc } = await outfitOnce(['unavailable', 'unavailable'])
    expect([inner.calls, record.calls, record.requests]).toEqual([2, 2, 1])
    expect(record.outcome.kind).toBe('error') // the app shows the deterministic result
    expect(result.status).toBe('provider_error')
    expect(acc).toMatchObject({ attempts: 2, retries: 1, requests: 1 })
  })

  it('an invalid ranking → exactly one correction (2 requests, 2 attempts, 0 retries)', async () => {
    const { record, acc } = await outfitOnce(['bad', 'ok'])
    expect([record.calls, record.requests]).toEqual([2, 2])
    expect(record.outcome).toMatchObject({ kind: 'ranked', firstError: expect.any(String) })
    expect(acc).toMatchObject({ attempts: 2, requests: 2, corrections: 1, retries: 0 })
  })

  it('a correction refused by the budget is not counted as a provider call (record.calls = real attempts)', async () => {
    const { inner, record, result } = await outfitOnce(['bad', 'ok'], new CallLedger(new CallBudget(1, null)))
    expect([inner.calls, record.calls, record.requests]).toEqual([1, 1, 2])
    expect(result).toMatchObject({ status: 'provider_error', errorKind: 'budget_stop' })
  })

  it('invalid twice → bounded (no third request), invalid output, deterministic fallback', async () => {
    const { inner, record, result } = await outfitOnce(['bad', 'bad', 'ok'])
    expect([inner.calls, record.requests]).toEqual([2, 2])
    expect(record.outcome.kind).toBe('invalid')
    expect(result.status).toBe('invalid_output')
  })
})

describe('mid-case refusals and the ledger contract', () => {
  it('a correction refused by the budget: the case reached the provider, so it is an attempted provider_error (BUDGET_STOP), not a skipped case', async () => {
    const budget = new CallBudget(1, null)
    const { inner, record, result, acc } = await stylistOnce(['bad_ref', 'ok'], new CallLedger(budget))
    expect([inner.calls, record.calls, record.requests]).toEqual([1, 1, 2])
    expect(result).toMatchObject({ status: 'provider_error', errorKind: 'budget_stop', requests: 2 })
    expect(acc).toMatchObject({ attempts: 1, attemptedCases: 1, budgetStopCases: 0, providerErrorCases: 1, caseErrors: { budget_stop: 1 }, skippedAttempts: { circuit_break: 0, budget_stop: 1 } })
  })

  it('an attempt after a NON-retryable failure is never counted as a retry (even without endCase)', () => {
    const l = new CallLedger()
    l.before('p')
    l.fail(new AiProviderError('auth', 'p', { status: 401 }))
    l.before('p')
    expect(l.retries).toBe(0)
    l.fail(new AiProviderError('timeout', 'p'))
    l.before('p')
    expect(l.retries).toBe(1)
  })
})

describe('correction turn accounting', () => {
  it('an invalid reference triggers exactly one correction: a second request, not a retry', async () => {
    const { inner, record, acc } = await stylistOnce(['bad_ref', 'ok'])
    expect([inner.calls, record.calls, record.requests]).toEqual([2, 2, 2])
    expect(acc).toMatchObject({ attempts: 2, requests: 2, corrections: 1, retries: 0, successRate: 1 })
  })

  it('correction + retry: a timeout on the correction is retried once (3 attempts, 2 requests, 1 retry)', async () => {
    const { record, acc } = await stylistOnce(['bad_ref', 'timeout', 'ok'])
    expect([record.calls, record.requests]).toEqual([3, 2])
    expect(acc).toMatchObject({ attempts: 3, requests: 2, corrections: 1, retries: 1, timeouts: 1 })
  })
})

describe('retry policy: one layer, the app classification', () => {
  const kinds: Array<[AiErrorKind, number]> = [
    ['timeout', 2], ['network', 2], ['rate_limited', 2], ['unavailable', 2],
    ['auth', 1], ['config', 1], ['invalid_request', 1], ['malformed_response', 1], ['content_filtered', 1], ['provider_error', 1], ['cancelled', 1],
  ]
  it.each(kinds)('vision %s → %i attempt(s)', async (kind, attempts) => {
    const inner = { name: 'v', model: 'm', calls: 0, async analyzeImage() { inner.calls++; throw new AiProviderError(kind, 'v', kind === 'rate_limited' ? { status: 429 } : {}) } }
    const ledger = new CallLedger()
    await expect(retryingVision(inner, ledger, noSleep).analyzeImage({} as never)).rejects.toMatchObject({ kind })
    expect([inner.calls, ledger.attempts, ledger.retries]).toEqual([attempts, attempts, attempts - 1])
  })

  it.each(kinds)('stylist %s → %i attempt(s) (runner retry only; the counted wrapper never retries)', async (kind, attempts) => {
    const { inner, acc } = await stylistOnce([kind, kind, kind])
    expect([inner.calls, acc.attempts, acc.retries]).toEqual([attempts, attempts, attempts - 1])
  })

  it('a 429 asking to wait longer than the app allows is not retried', async () => {
    const inner = { name: 'v', model: 'm', calls: 0, async analyzeImage() { inner.calls++; throw new AiProviderError('rate_limited', 'v', { status: 429, retryAfterMs: 60_000 }) } }
    const ledger = new CallLedger()
    await expect(retryingVision(inner, ledger, noSleep).analyzeImage({} as never)).rejects.toMatchObject({ kind: 'rate_limited' })
    expect([inner.calls, ledger.retries]).toEqual([1, 0])
    // The unused retry is not carried into the next case.
    expect(ledger.endCase()).toEqual({ skip: null, attempts: 1 })
    ledger.before('v')
    expect(ledger.retries).toBe(0)
  })
})

const conf = Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9]))
const JEANS = { subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'regular', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: conf }
let dir = ''
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bakeoff-acc-'))
  const items = syntheticVisionItems().filter((i) => ['jeans_blue', 'tshirt_red', 'shoes_white'].includes(i.id))
  for (const item of items) await fs.writeFile(path.join(dir, item.file), await renderSynthetic(item))
  await fs.writeFile(path.join(dir, 'labels.json'), JSON.stringify({ version: 'synthetic-acc-v1', kind: 'synthetic', items: items.map(({ id, file, expected }) => ({ id, file, expected })) }))
})
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('vision section accounting (app pipeline, one retry layer)', () => {
  it('per image: attempts = inner provider calls; a transient failure costs one retry; usage and cost from the price', async () => {
    let n = 0
    const inner: VisionProvider & { calls: number } = {
      name: 'v', model: 'm', calls: 0,
      async analyzeImage() {
        inner.calls++
        if (n++ === 0) throw new AiProviderError('timeout', 'v')
        return { output: JEANS, metadata: { provider: 'v', model: 'm', usage: { inputTokens: 500, outputTokens: 50 } } }
      },
    }
    const price = { inputUsdPerMTok: 2, outputUsdPerMTok: 8 }
    const ledger = new CallLedger(null, price)
    const results: CaseResult[] = []
    const labels = JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8'))
    await evaluateVisionConfig(retryingVision(inner, ledger, noSleep), { label: 'x', provider: 'gemini', model: 'm', maxSide: 512 }, dir, labels.items, (r) => {
      results.push(caseResult(r.latencyMs, 1, r.outcome, ledger.endCase()))
    })
    const acc = accountSection('vision', ledger, results, price, 'test price')
    expect(inner.calls).toBe(4)
    expect(acc).toMatchObject({ cases: 3, attemptedCases: 3, requests: 3, attempts: 4, retries: 1, timeouts: 1, successfulCases: 3, timeoutRate: 0.25 })
    expect(acc.tokens).toEqual({ input: 1500, output: 150, total: 1650, attemptsReporting: 3 })
    expect(acc.costUsd).toBeCloseTo((1500 * 2 + 150 * 8) / 1e6, 8)
  })
})

describe('call budget and cost cap (enforced before and during execution)', () => {
  it('the budget refuses attempts beyond max calls, locally (no provider call) and visibly (budget_stop)', async () => {
    const budget = new CallBudget(3, null)
    const ledger = new CallLedger(budget)
    const inner = llm(['ok'])
    const p = countedLLM(inner, ledger)
    const results: CaseResult[] = []
    for (let i = 0; i < 5; i++) {
      const r = await runStylistCase(p, CASE)
      results.push(caseResult(r.latencyMs, r.requests, r.outcome, ledger.endCase()))
    }
    expect(inner.calls).toBe(3)
    expect([budget.attemptsUsed, budget.exhausted]).toEqual([3, 'max_calls'])
    expect(results.map((r) => r.status)).toEqual(['success', 'success', 'success', 'budget_stop', 'budget_stop'])
    expect(accountSection('stylist', ledger, results, null)).toMatchObject({ attempts: 3, budgetStopCases: 2, attemptedCases: 3, skippedAttempts: { circuit_break: 0, budget_stop: 2 } })
  })

  it('the cost cap refuses, before it is sent, an attempt whose reservation would not fit', () => {
    const budget = new CallBudget(null, 0.003)
    const ledger = new CallLedger(budget, { inputUsdPerMTok: 1, outputUsdPerMTok: 2 })
    const est = { ok: true as const, tokens: { textInputTokens: 1000, imageInputTokens: 0, outputTokens: 100 } } // reserves $0.0012
    ledger.ok({ inputTokens: 1000, outputTokens: 100 }, ledger.before('p', est)) // reported $0.0012
    ledger.ok({ inputTokens: 1000, outputTokens: 100 }, ledger.before('p', est)) // charged $0.0024
    expect(budget.exhausted).toBeNull()
    expect(() => ledger.before('p', est)).toThrow(AiProviderError) // 0.0024 + 0.0012 > 0.003
    expect([budget.exhausted, ledger.endCase().skip, budget.attemptsUsed]).toEqual(['max_cost', 'budget_stop', 2])
    expect(budget.costSpentUsd).toBe(0.0024)
  })

  it('the upper bound is cases × (1 + correction) × (1 + retry) × runs, per provider and feature; the CLI refuses a live plan without a cap', () => {
    const plan = planCalls([{ provider: 'gemini', feature: 'stylist', cases: 17 }, { provider: 'gemini', feature: 'outfit', cases: 11 }, { provider: 'openai', feature: 'vision', cases: 15 }], 3, null)
    expect(plan.upperBoundCalls).toBe((17 * 4 + 11 * 4 + 15 * 2) * 3)
    expect(() => assertCapForLive(plan)).toThrow(/needs --max-calls/)
    expect(() => assertCapForLive({ ...plan, maxCalls: 1000 })).not.toThrow()
    expect(() => assertCapForLive(planCalls([], 3, null))).not.toThrow() // nothing live: no cap needed
    expect(() => planCalls([{ provider: 'gemini', feature: 'vision', cases: 501 }], 1, null)).not.toThrow()
  })

  it('--max-cost-usd needs a configured price for every live section, checked before any provider is built', async () => {
    let built = 0
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g' }
    await expect(buildBakeoff(env, { maxCostUsd: 1, providers: { llm: () => (built++, llm(['ok'])) } })).rejects.toThrow(/cannot be enforced: gemini\/stylist: no price above zero for this provider and exact model/)
    expect(built).toBe(0)
    expect(parseMaxCost('2.50')).toBe(2.5)
    for (const bad of ['0', '-1', 'abc', '1e3']) expect(() => parseMaxCost(bad)).toThrow(/positive amount/)
  })

  it('an oversized dataset section is refused before any call', async () => {
    const big = path.join(dir, 'big')
    await fs.mkdir(big, { recursive: true })
    const item = syntheticVisionItems()[0]
    await fs.writeFile(path.join(big, item.file), await renderSynthetic(item))
    const items = Array.from({ length: 501 }, (_, i) => ({ id: `i${i}`, file: item.file, expected: item.expected }))
    await fs.writeFile(path.join(big, 'labels.json'), JSON.stringify({ items }))
    let built = 0
    await expect(buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'v' }, { visionDataset: big, providers: { vision: () => (built++, { name: 'v', model: 'm', analyzeImage: async () => ({ output: JEANS, metadata: { provider: 'v', model: 'm', usage: {} } }) }) } })).rejects.toThrow(/above the limit of 500/)
    expect(built).toBe(0)
  })
})

describe('cost cap end to end', () => {
  it('the runtime cost cap stops later attempts across the bake-off (BUDGET_STOP), never more spend than one attempt past the cap', async () => {
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }
    // Reported $0.0012 per attempt; every attempt first reserves its (larger) estimate, so the run stops before the cap.
    const cap = 0.02
    const inner = llm(['ok'])
    const r = await buildBakeoff(env, { maxCostUsd: cap, providers: { llm: () => inner } })
    const b = r.execution.budget
    expect(b.exhausted).toBe('max_cost')
    expect(inner.calls).toBe(b.attemptsUsed)
    expect(b.costSpentUsd).toBeCloseTo(0.0012 * b.attemptsUsed, 6)
    expect(b.costAccounting).toMatchObject({ inputEstimateStatus: 'HEURISTIC_NOT_GUARANTEE', providerReportedAttempts: b.attemptsUsed, retainedReservationAttempts: 0, unpricedOrUnknownCostAttempts: 0 })
    expect(b.costAccounting.conservativeCostUsd).toBeLessThanOrEqual(cap)
    const st = r.live[0].accounting.find((a) => a.feature === 'stylist')!
    expect(st.budgetStopCases).toBe(stylistCases().length - b.attemptsUsed)
    expect(r.live[0].failures.some((f) => f.failed[0] === 'BUDGET_STOP')).toBe(true)
  })
})

describe('provider source labels', () => {
  it('injected providers that ran → TEST_ONLY on every measured cell; nothing ran → "none"', async () => {
    const ran = await buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g' }, { providers: { llm: () => llm(['ok']) } })
    expect(ran.execution.providerSource).toBe('TEST_ONLY')
    const cell = ran.comparison.find((c) => c.dimension === 'Stylist validity (final)')!
    expect(cell.gemini).toMatch(/^TEST_ONLY \d/)
    expect(cell.openai).toBe('NOT_TESTED') // never marked: there is no number
    expect(bakeoffMarkdown(ran)).toContain('**TEST_ONLY:** injected scripted providers')
    const idle = await buildBakeoff({}, { providers: { llm: () => llm(['ok']) } })
    expect(idle.execution.providerSource).toBe('none')
  })
})

describe('dataset integrity', () => {
  it('a dataset changed during execution stops every later provider call: DATASET_INTEGRITY_FAILURE, no further run', async () => {
    const file = path.join(dir, 'jeans_blue.png')
    const original = await fs.readFile(file)
    let visionCalls = 0, textBuilt = 0
    const tamper: VisionProvider = {
      name: 'v', model: 'm',
      async analyzeImage() {
        if (visionCalls++ === 0) await fs.writeFile(file, Buffer.concat([original, Buffer.from([1])]))
        return { output: JEANS, metadata: { provider: 'v', model: 'm', usage: {} } }
      },
    }
    try {
      const env = { GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_OPENAI_VISION_MODEL: 'ov', AI_EVAL_GEMINI_MODEL: 'g', AI_EVAL_OPENAI_MODEL: 'o' }
      const r = await buildBakeoff(env, { visionDataset: dir, runs: 3, sleep: noSleep, providers: { vision: () => tamper, llm: () => (textBuilt++, llm(['ok'])) } })
      expect(r.execution.integrity.status).toBe(DATASET_INTEGRITY_FAILURE)
      expect(r.runs ?? [{ run: 1 }]).toHaveLength(1) // runs 2 and 3 never started
      // Each image is re-hashed right before it is sent: the changed image is never sent, nothing after it is called.
      expect(visionCalls).toBe(1)
      expect(textBuilt).toBe(0)
      const g = r.live[0], o = r.live[1]
      expect(g.features.find((f) => f.feature === 'vision')).toMatchObject({ status: 'NOT_TESTED', reason: DATASET_INTEGRITY_FAILURE })
      expect(g.accounting.find((a) => a.feature === 'vision')).toMatchObject({ attempts: 1, cases: 1 }) // what was spent stays visible
      expect(g.features.find((f) => f.feature === 'stylist')).toMatchObject({ status: 'NOT_TESTED', reason: DATASET_INTEGRITY_FAILURE })
      expect(o.features.every((f) => f.status === 'NOT_TESTED' && (f as { reason: string }).reason === DATASET_INTEGRITY_FAILURE)).toBe(true)
      expect(bakeoffMarkdown(r)).toContain(`dataset integrity: ${DATASET_INTEGRITY_FAILURE}`)
    } finally {
      await fs.writeFile(file, original)
    }
  })

  it('labels.json changed during a section (images intact): the next section re-hash catches it; nothing later is called', async () => {
    const labelsFile = path.join(dir, 'labels.json')
    const original = await fs.readFile(labelsFile)
    let textBuilt = 0
    const v: VisionProvider = {
      name: 'v', model: 'm',
      async analyzeImage() {
        await fs.writeFile(labelsFile, Buffer.concat([original, Buffer.from(' ')]))
        return { output: JEANS, metadata: { provider: 'v', model: 'm', usage: {} } }
      },
    }
    try {
      const r = await buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_GEMINI_MODEL: 'g' }, { visionDataset: dir, sleep: noSleep, providers: { vision: () => v, llm: () => (textBuilt++, llm(['ok'])) } })
      expect(r.execution.integrity.status).toBe(DATASET_INTEGRITY_FAILURE)
      expect(textBuilt).toBe(0)
      expect(r.live[0].features.find((f) => f.feature === 'stylist')).toMatchObject({ status: 'NOT_TESTED', reason: DATASET_INTEGRITY_FAILURE })
    } finally {
      await fs.writeFile(labelsFile, original)
    }
  })

  it('an unchanged dataset passes every check', async () => {
    const r = await buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv' }, { visionDataset: dir, runs: 2, sleep: noSleep, providers: { vision: () => ({ name: 'v', model: 'm', analyzeImage: async () => ({ output: JEANS, metadata: { provider: 'v', model: 'm', usage: {} } }) }) } })
    expect(r.execution.integrity.status).toBe('OK')
    expect(r.execution.integrity.checks).toBeGreaterThanOrEqual(2)
    expect(r.runs).toHaveLength(2)
  })
})

describe('provider isolation and secrets', () => {
  it('a provider error carrying a secret never reaches the report; the other provider is untouched', async () => {
    const env = { GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g', AI_EVAL_OPENAI_MODEL: 'o' }
    const r = await buildBakeoff(env, { providers: { llm: (p) => (p === 'gemini' ? llm([new Error(`upstream said Authorization: Bearer ${FAKE}`)]) : llm(['ok'])) } })
    const g = r.live[0].accounting.find((a) => a.feature === 'stylist')!
    const o = r.live[1].accounting.find((a) => a.feature === 'stylist')!
    expect(g.attemptErrors).toEqual({ unexpected: CIRCUIT_MAX_CONSECUTIVE }) // not retryable; the consecutive limit opens the circuit
    expect(g.circuitOpen).toBe('unexpected')
    expect([o.attemptErrors, o.circuitOpen, o.successRate]).toEqual([{}, null, 1])
    for (const text of [JSON.stringify(r), bakeoffMarkdown(r)]) {
      expect(text).not.toContain(FAKE)
      expect(text).not.toMatch(/Bearer|Authorization/)
    }
  })
})
