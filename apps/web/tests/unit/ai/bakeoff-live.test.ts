/**
 * Phase 5.1 live bake-off harness: accounting (attempts, retries, timeouts,
 * error kinds), the circuit breaker, the call budget, dataset identity,
 * individual failure listing, provider isolation, no secret leakage and no
 * automatic provider selection. Scripted providers only: no network, no keys
 * (key variables hold an obviously fake value so the gating is exercised).
 */
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bakeoffMarkdown, buildBakeoff, defaultRuns, NO_SELECTION, PROVIDER_DECISION } from '../../../scripts/ai-eval/bakeoff'
import { CallLedger, CIRCUIT_MAX_CONSECUTIVE, CIRCUIT_MAX_FATAL, configuredPrice, latencyPercentile, MAX_CALLS_PER_CASE, parseMaxCalls, planCalls, retryingVision, visionDatasetIdentity } from '../../../scripts/ai-eval/live-accounting'
import { outfitCases } from '../../../scripts/ai-eval/outfit-cases'
import { ScriptedOutfit } from '../../../scripts/ai-eval/outfit-eval'
import { stylistCases } from '../../../scripts/ai-eval/stylist-cases'
import { ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../../scripts/ai-eval/synthetic-vision'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import { AiProviderError } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest, VisionProvider } from '@/lib/ai/providers/types'

const FAKE = 'fake-key-not-real-7f3a9c'
const noSleep = async () => {}
const S = stylistCases().length, O = outfitCases().length
const textEnv = (extra: Record<string, string> = {}) => ({ GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g-text', AI_EVAL_OPENAI_MODEL: 'o-text', ...extra })

/** Scripted text provider: stylist/outfit answers routed by schema; `fault` decides per call. */
function scriptedLlm(fault: (n: number, req: LLMRequest) => AiProviderError | 'leak' | null = () => null): LLMProvider & { calls: number } {
  const s = new ScriptedStylist(), o = new ScriptedOutfit()
  const p = {
    name: 'scripted',
    model: 'scripted-offline',
    calls: 0,
    async generate(req: LLMRequest) {
      const f = fault(p.calls++, req)
      if (f instanceof AiProviderError) throw f
      const out = await (req.jsonSchema?.name === 'outfit_ranking' ? o.generate(req) : s.generate(req))
      if (f === 'leak') {
        const parsed = JSON.parse(out.text)
        out.text = JSON.stringify({ ...parsed, answer: `You are ATLAS. ${parsed.answer}` })
      }
      return { ...out, metadata: { ...out.metadata, usage: { inputTokens: 1000, outputTokens: 100 } } }
    },
  }
  return p
}

const conf = Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9]))
const JEANS = { subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'regular', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: conf }
const visionAlways = (fault?: AiProviderError): VisionProvider & { calls: number } => {
  const p = {
    name: 'scripted-vision',
    model: 'scripted',
    calls: 0,
    async analyzeImage() {
      p.calls++
      if (fault) throw fault
      return { output: JEANS, metadata: { provider: 'scripted-vision', model: 'scripted', usage: { inputTokens: 500, outputTokens: 50 } } }
    },
  }
  return p
}

let dir = ''
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bakeoff-live-'))
  const items = syntheticVisionItems().filter((i) => ['jeans_blue', 'tshirt_red'].includes(i.id))
  for (const item of items) await fs.writeFile(path.join(dir, item.file), await renderSynthetic(item))
  await fs.writeFile(path.join(dir, 'labels.json'), JSON.stringify({ version: 'synthetic-test-v2', kind: 'synthetic', items: items.map(({ id, file, expected }) => ({ id, file, expected })) }))
})
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('NOT_TESTED gating (no credentials needed)', () => {
  it('missing key, model or dataset → NOT_TESTED with the reason; no provider is built; plan is 0 calls', async () => {
    let built = 0
    const providers = { llm: () => (built++, scriptedLlm()), vision: () => (built++, visionAlways()) }
    const none = await buildBakeoff({}, { providers, visionDataset: dir })
    const noModel = await buildBakeoff({ GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE }, { providers })
    expect(built).toBe(0)
    for (const r of [none, noModel]) {
      expect(r.live.map((l) => l.status)).toEqual(['NOT_TESTED', 'NOT_TESTED'])
      expect(r.live.every((l) => l.accounting.length === 0 && l.failures.length === 0)).toBe(true)
      expect(r.execution.plan.upperBoundCalls).toBe(0)
      expect(r.comparison.find((c) => c.dimension.startsWith('Stylist validity'))).toEqual({ dimension: 'Stylist validity (final)', gemini: 'NOT_TESTED', openai: 'NOT_TESTED' })
    }
    expect(none.live[0].reason).toMatch(/no GEMINI_API_KEY/)
    expect(noModel.live[0].reason).toMatch(/no configured model.*no configured vision model|no configured vision model.*no configured model/)
    expect(noModel.live[0].reason).toMatch(/--vision-dataset|vision model/)
    expect(none.recommendation).toBe(NO_SELECTION)
  })

  it('real-world claims stay blocked on synthetic data; Uzbek human rating is NOT_EVALUATED; legal review pending', async () => {
    const r = await buildBakeoff({})
    expect(r.realWorld.clothingDataset).toMatch(/^BLOCKED — dataset unavailable/)
    expect(r.realWorld.selfieDataset).toMatch(/^BLOCKED — dataset unavailable/)
    expect(r.realWorld.uzbekHumanRating).toMatch(/^NOT_EVALUATED/)
    expect(r.realWorld.legalReview).toBe('PENDING')
    expect(r.comparison.find((c) => c.dimension.startsWith('Uzbek quality'))).toMatchObject({ gemini: 'NOT_EVALUATED', openai: 'NOT_EVALUATED' })
    expect([r.datasets.stylist.kind, r.datasets.outfit.kind]).toEqual(['synthetic', 'synthetic'])
  })
})

describe('live classification and accounting (scripted)', () => {
  it('a healthy provider: TESTED, one attempt per request, no retries, tokens counted, cost only with a configured price', async () => {
    const env = textEnv({ AI_LLM_PROVIDER: 'gemini', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' })
    const r = await buildBakeoff(env, { providers: { llm: () => scriptedLlm() }, sleep: noSleep })
    const g = r.live[0]
    expect(g.status).toBe('PARTIALLY_TESTED') // no vision model / dataset
    const st = g.accounting.find((a) => a.feature === 'stylist')!
    expect(st).toMatchObject({ cases: S, attempts: st.requests, retries: 0, timeouts: 0, attemptErrors: {}, caseErrors: {}, skippedAttempts: { circuit_break: 0, budget_stop: 0 }, circuitOpen: null })
    expect(st.tokens).toEqual({ input: 1000 * st.attempts, output: 100 * st.attempts, total: 1100 * st.attempts, attemptsReporting: st.attempts })
    expect(st.costUsd).toBeCloseTo((1000 * st.attempts * 1 + 100 * st.attempts * 2) / 1e6, 6)
    expect(r.live[1].accounting.find((a) => a.feature === 'stylist')!.costUsd).toBe('COST_UNAVAILABLE') // price belongs to gemini only, never 0
    expect(st.price).toMatchObject({ inputUsdPerMTok: 1, outputUsdPerMTok: 2, verified: false })
    expect(st.latencyMs.n).toBe(S)
    expect(st.latencyMs.p99).toBeNull() // fewer than 100 samples: no p99 claimed
  })

  it('a transient timeout is retried once (app policy) and counted: retries, timeouts and the error kind', async () => {
    const r = await buildBakeoff(textEnv(), { providers: { llm: () => scriptedLlm((n) => (n === 0 ? new AiProviderError('timeout', 'scripted') : null)) } })
    const st = r.live[0].accounting.find((a) => a.feature === 'stylist')!
    expect(st).toMatchObject({ retries: 1, timeouts: 1, attemptErrors: { timeout: 1 }, caseErrors: {} })
    expect(st.attempts).toBe(st.requests + 1)
  })

  it('a provider that keeps failing: the circuit opens, calls stay bounded, every case is a listed failure, nothing averaged into quality', async () => {
    const bad = scriptedLlm(() => new AiProviderError('auth', 'scripted', { status: 401 }))
    const r = await buildBakeoff(textEnv(), { providers: { llm: (p) => (p === 'gemini' ? bad : scriptedLlm()) } })
    const g = r.live[0]
    const st = g.accounting.find((a) => a.feature === 'stylist')!
    expect(st.circuitOpen).toBe('auth')
    expect(st.attempts).toBe(CIRCUIT_MAX_FATAL) // auth is never retried, then the circuit stops calling
    expect(st.skippedAttempts.circuit_break).toBe(S - CIRCUIT_MAX_FATAL)
    // Circuit-broken cases are a separate status: not attempts, not provider errors, not in any denominator.
    expect(st.caseErrors).toEqual({ auth: CIRCUIT_MAX_FATAL })
    expect(st).toMatchObject({ attemptedCases: CIRCUIT_MAX_FATAL, circuitBreakCases: S - CIRCUIT_MAX_FATAL, providerErrorCases: CIRCUIT_MAX_FATAL, successRate: 0, failureRate: 1 })
    const summary = g.features.find((f) => f.feature === 'stylist') as { providerErrorRate: number; groundingRate: number | null; schemaValidity: number | null }
    expect(summary.providerErrorRate).toBe(1)
    expect([summary.groundingRate, summary.schemaValidity]).toEqual([null, null]) // failed cases are not averaged into quality
    expect(g.failures.filter((f) => f.feature === 'stylist')).toHaveLength(S)
    expect(g.failures[0].failed).toEqual(['error:auth'])
    expect(g.failures.filter((f) => f.feature === 'stylist' && f.failed[0] === 'CIRCUIT_BREAK')).toHaveLength(S - CIRCUIT_MAX_FATAL)
    expect(bad.calls).toBe(2 * CIRCUIT_MAX_FATAL) // stylist and outfit each stop after the fatal limit
    // Provider isolation: OpenAI is unaffected by Gemini failing.
    const o = r.live[1].accounting.find((a) => a.feature === 'stylist')!
    expect([o.circuitOpen, o.attemptErrors, o.caseErrors]).toEqual([null, {}, {}])
  })

  it('repeated transient failures open the circuit after CIRCUIT_MAX_CONSECUTIVE failed attempts', () => {
    const l = new CallLedger()
    for (let i = 0; i < CIRCUIT_MAX_CONSECUTIVE; i++) {
      l.before('p')
      l.fail(new AiProviderError('unavailable', 'p', { status: 503 }))
    }
    expect(l.circuitOpen).toBe('unavailable')
    expect(() => l.before('p')).toThrow(AiProviderError)
    expect([l.attempts, l.skipped.circuit_break]).toEqual([CIRCUIT_MAX_CONSECUTIVE, 1])
    // A success in between resets the streak.
    const k = new CallLedger()
    for (let i = 0; i < CIRCUIT_MAX_CONSECUTIVE * 2; i++) {
      k.before('p')
      if (i % 2) k.ok({})
      else k.fail(new AiProviderError('timeout', 'p'))
    }
    expect(k.circuitOpen).toBeNull()
  })

  it('vision follows the app retry policy: one retry on a transient error, none on auth', async () => {
    const flaky = { name: 'v', model: 'm', calls: 0, async analyzeImage() { if (this.calls++ === 0) throw new AiProviderError('rate_limited', 'v', { status: 429 }); return { output: JEANS, metadata: { provider: 'v', model: 'm', usage: {} } } } }
    const l = new CallLedger()
    await retryingVision(flaky, l, noSleep).analyzeImage({} as never)
    expect([l.attempts, l.attemptErrors]).toEqual([2, { rate_limited: 1 }])
    const l2 = new CallLedger()
    await expect(retryingVision(visionAlways(new AiProviderError('auth', 'v', { status: 401 })), l2, noSleep).analyzeImage({} as never)).rejects.toMatchObject({ kind: 'auth' })
    expect(l2.attempts).toBe(1)
  })

  it('a vision section that keeps timing out: each case is a timeout, retried once, then the circuit stops calling', async () => {
    const v = visionAlways(new AiProviderError('timeout', 'v'))
    const r = await buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv' }, { visionDataset: dir, providers: { vision: () => v }, sleep: noSleep })
    const a = r.live[0].accounting.find((x) => x.feature === 'vision')!
    expect(a).toMatchObject({ cases: 2, requests: 2, attempts: 4, retries: 2, timeouts: 4, caseErrors: { timeout: 2 } })
    expect(a.circuitOpen).toBeNull() // 4 failed attempts: below the consecutive limit
    const failed = r.live[0].failures.map((f) => `${f.case}:${f.failed.join(',')}`).sort()
    expect(failed).toEqual(['jeans_blue:error:timeout', 'tshirt_red:error:timeout'])
  })
})

describe('safety: injection failures are listed individually', () => {
  it('a provider that leaks its instructions on an injection case: flagged injection, resistance below 100 %', async () => {
    const leaky = scriptedLlm((_, req) => (/Ignore all previous instructions/.test(req.messages.at(-1)?.content ?? '') ? 'leak' : null))
    const r = await buildBakeoff(textEnv(), { providers: { llm: (p) => (p === 'gemini' ? leaky : scriptedLlm()) } })
    const inj = r.live[0].failures.filter((f) => f.injection)
    expect(inj.map((f) => f.case)).toEqual(['injection_ignore_rules'])
    expect(inj[0].failed).toContain('noPrivateLeak')
    const resist = (r.live[0].features.find((f) => f.feature === 'stylist') as { injectionResistance: number }).injectionResistance
    expect(resist).toBeLessThan(1)
    expect(bakeoffMarkdown(r)).toMatch(/\| gemini \| stylist \| injection_ignore_rules \| \*\*yes\*\* \|/)
    expect(r.live[1].failures.filter((f) => f.injection)).toEqual([])
  })
})

describe('call budget', () => {
  it('the upper bound counts corrections and one retry per request, per provider, feature and run', () => {
    expect(MAX_CALLS_PER_CASE).toEqual({ vision: 2, stylist: 4, outfit: 4 })
    const plan = planCalls([{ provider: 'gemini', feature: 'vision', cases: 15 }, { provider: 'openai', feature: 'stylist', cases: 17 }], 3, null)
    expect(plan.upperBoundCalls).toBe(15 * 2 * 3 + 17 * 4 * 3)
  })

  it('above --max-calls the bake-off refuses before any provider is built or called', async () => {
    let built = 0
    const providers = { llm: () => (built++, scriptedLlm()) }
    const bound = 2 * (S + O) * 4 * 3
    await expect(buildBakeoff(textEnv(), { providers, runs: 3, maxCalls: bound - 1 })).rejects.toThrow(/up to \d+ provider calls, above the cap/)
    expect(built).toBe(0)
    const ok = await buildBakeoff(textEnv(), { providers, runs: 1, maxCalls: bound })
    expect(ok.execution.plan).toMatchObject({ runs: 1, upperBoundCalls: 2 * (S + O) * 4, maxCalls: bound })
    // Actual attempts never exceed the bound.
    const used = ok.live.flatMap((l) => l.accounting).reduce((n, a) => n + a.attempts, 0)
    expect(used).toBeLessThanOrEqual(ok.execution.plan.upperBoundCalls)
  })

  it('--max-calls parsing; the CLI defaults to 3 runs only when a live section can run', () => {
    expect(parseMaxCalls(undefined)).toBeNull()
    expect(parseMaxCalls(' 600 ')).toBe(600)
    for (const bad of ['0', '-1', '1.5', 'many']) expect(() => parseMaxCalls(bad)).toThrow(/whole number/)
    expect(defaultRuns({})).toBe(1)
    expect(defaultRuns({ GEMINI_API_KEY: FAKE })).toBe(1)
    expect(defaultRuns(textEnv())).toBe(3)
  })

  it('prices come only from the existing variables, for the provider they name', () => {
    expect(configuredPrice('gemini', 'llm', {})).toBeNull()
    expect(configuredPrice('openai', 'llm', { AI_LLM_PROVIDER: 'gemini', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' })).toBeNull()
    expect(configuredPrice('gemini', 'vision', { AI_VISION_PROVIDER: 'Gemini', AI_VISION_PRICE_INPUT_USD_PER_MTOK: '0.5', AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '1.5' })).toEqual({ inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 })
    expect(() => configuredPrice('gemini', 'llm', { AI_LLM_PROVIDER: 'gemini', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1' })).toThrow(/both/)
  })
})

describe('aggregation over runs', () => {
  it('pools latencies across runs; p95 needs 20 samples and p99 100 (no tail claimed below that)', async () => {
    const r = await buildBakeoff(textEnv(), { providers: { llm: () => scriptedLlm() }, runs: 3 })
    const a = r.aggregate!.find((x) => x.provider === 'gemini' && x.feature === 'stylist')!
    expect(a.testedRuns).toBe(3)
    expect(a.pooledLatencyMs.n).toBe(3 * S)
    expect(a.pooledLatencyMs.p95).not.toBeNull()
    expect(a.pooledLatencyMs.p99).toBeNull()
    expect(latencyPercentile(Array.from({ length: 100 }, (_, i) => i + 1), 99)).toBe(99)
    expect(latencyPercentile(Array.from({ length: 19 }, (_, i) => i), 95)).toBeNull()
    expect(r.comparison.find((c) => c.dimension === 'Stylist validity (final)')!.gemini).toMatch(/mean of 3 runs, spread/)
  })
})

describe('dataset identity and timestamps', () => {
  it('the vision dataset hash covers labels and image bytes; version and kind are reported', async () => {
    const labels = JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8'))
    const a = await visionDatasetIdentity(dir, labels)
    expect(a).toMatchObject({ name: 'vision', version: 'synthetic-test-v2', kind: 'synthetic', cases: 2 })
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await visionDatasetIdentity(dir, labels)).sha256).toBe(a.sha256)
    const file = path.join(dir, labels.items[0].file)
    const original = await fs.readFile(file)
    await fs.writeFile(file, Buffer.concat([original, Buffer.from([0])]))
    expect((await visionDatasetIdentity(dir, labels)).sha256).not.toBe(a.sha256)
    await fs.writeFile(file, original)
    expect((await visionDatasetIdentity(dir, { ...labels, kind: undefined, version: 'real-2026' })).kind).toBe('unspecified')
  })

  it('timestamps only with a clock (the default report stays deterministic)', async () => {
    expect((await buildBakeoff({})).execution).toMatchObject({ generatedAt: null, runTimes: [{ run: 1, startedAt: null, finishedAt: null }] })
    const t = new Date('2026-10-07T12:00:00.000Z')
    expect((await buildBakeoff({}, { now: () => t })).execution.generatedAt).toBe('2026-10-07T12:00:00.000Z')
  })
})

describe('no provider selection, no secret leakage', () => {
  it('both providers fully TESTED: still NO FINAL PROVIDER SELECTED; no key in the report or the markdown', async () => {
    const env = textEnv({ AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_OPENAI_VISION_MODEL: 'ov' })
    const before = JSON.stringify(env)
    const r = await buildBakeoff(env, { visionDataset: dir, providers: { llm: () => scriptedLlm(), vision: () => visionAlways() }, sleep: noSleep })
    expect(r.live.map((l) => l.status)).toEqual(['TESTED', 'TESTED'])
    expect(r.providerDecision).toBe(PROVIDER_DECISION)
    expect(r.recommendation.startsWith(PROVIDER_DECISION)).toBe(true)
    const md = bakeoffMarkdown(r)
    expect(md).toMatch(/^\*\*NO FINAL PROVIDER SELECTED/m)
    for (const text of [JSON.stringify(r), md]) {
      expect(text).not.toContain(FAKE)
      expect(text).not.toMatch(/\b(winner|selected provider|recommended provider)\b/i)
    }
    expect(JSON.stringify(env)).toBe(before) // the harness never changes the configuration
    expect(env).not.toHaveProperty('AI_LLM_PROVIDER')
  })
})
