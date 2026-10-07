/**
 * Phase 5.0 bake-off: the live vision section, NOT_TESTED semantics and
 * repeated runs (--runs). Scripted providers only: no network, no keys (the
 * key variables hold an obviously fake value so the gating is exercised).
 */
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aggregateRuns, buildBakeoff, compare, configuredVisionModel, MAX_RUNS, NO_SELECTION, recommend, withAccountedLatency, type VisionSummary } from '../../../scripts/ai-eval/bakeoff'
import { latencyStats, type SectionAccounting } from '../../../scripts/ai-eval/live-accounting'
import { ScriptedOutfit } from '../../../scripts/ai-eval/outfit-eval'
import { ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../../scripts/ai-eval/synthetic-vision'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import { AiProviderError } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest, VisionProvider, VisionRequest } from '@/lib/ai/providers/types'

const FAKE = 'not-a-real-key'
const conf = Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9]))
const empty = { category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null, style: null, season: [], gender: null, formality: null }
const JEANS = { subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'regular', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: conf }
const LANDSCAPE = { subject: 'no_garment', ...empty, confidence: Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0])) }

/**
 * Answers the dataset in order: jeans right, landscape right, then the scripted
 * third outcome. A scripted error persists on the retry (the bake-off applies
 * the app's single retry, Phase 5.1).
 */
function scriptedVision(third: 'timeout' | 'unavailable' | 'invalid' | 'garment', latencyMs = 0): VisionProvider & { calls: number } {
  return {
    name: 'scripted-vision',
    model: 'scripted',
    calls: 0,
    async analyzeImage(_req: VisionRequest) {
      const i = this.calls++
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs))
      if (i >= 2 && (third === 'timeout' || third === 'unavailable')) throw new AiProviderError(third, 'scripted-vision')
      const output = i === 0 ? JEANS : i === 1 ? LANDSCAPE : third === 'invalid' ? { subject: 'single_garment' } : JEANS
      return { output, metadata: { provider: 'scripted-vision', model: 'scripted', usage: { inputTokens: 100, outputTokens: 20 } } }
    },
  }
}

/** Routes the outfit ranking to ScriptedOutfit and everything else to ScriptedStylist. */
const scriptedLlm = (): LLMProvider => {
  const s = new ScriptedStylist(), o = new ScriptedOutfit()
  return { name: 'scripted', model: 'scripted-offline', generate: (req: LLMRequest) => (req.jsonSchema?.name === 'outfit_ranking' ? o.generate(req) : s.generate(req)) }
}

let dir = ''
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bakeoff-'))
  const pick = ['jeans_blue', 'no_garment_landscape', 'ambiguous_blob']
  const items = syntheticVisionItems().filter((i) => pick.includes(i.id)).sort((a, b) => pick.indexOf(a.id) - pick.indexOf(b.id))
  for (const item of items) await fs.writeFile(path.join(dir, item.file), await renderSynthetic(item))
  await fs.writeFile(path.join(dir, 'labels.json'), JSON.stringify({ version: 'synthetic-test-v1', items: items.map(({ id, file, expected }) => ({ id, file, expected })) }))
})
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

const visionOf = (r: Awaited<ReturnType<typeof buildBakeoff>>, provider: 'gemini' | 'openai') => r.live.find((l) => l.provider === provider)!.features.find((f) => f.feature === 'vision')!

describe('bake-off vision: NOT_TESTED semantics (never estimated)', () => {
  it('no key → NOT_TESTED with the reason, every metric null, even with a model and a dataset', async () => {
    const r = await buildBakeoff({ AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_OPENAI_VISION_MODEL: 'ov' }, { visionDataset: dir, providers: { vision: () => scriptedVision('garment') } })
    for (const p of ['gemini', 'openai'] as const) {
      const v = visionOf(r, p)
      expect(v.status).toBe('NOT_TESTED')
      expect((v as { reason: string }).reason).toMatch(/no (GEMINI|OPENAI)_API_KEY/)
      expect([v.schemaValidity, v.latencyP50, v.latencyP95]).toEqual([null, null, null])
    }
    expect(r.recommendation).toBe(NO_SELECTION)
  })

  it('a key but no vision model → NOT_TESTED (no built-in default); a model but no dataset → NOT_TESTED', async () => {
    const noModel = await buildBakeoff({ GEMINI_API_KEY: FAKE }, { visionDataset: dir, providers: { vision: () => scriptedVision('garment') } })
    expect((visionOf(noModel, 'gemini') as { reason: string }).reason).toMatch(/no configured vision model/)
    const noData = await buildBakeoff({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv' }, { providers: { vision: () => scriptedVision('garment') } })
    expect(visionOf(noData, 'gemini').status).toBe('NOT_TESTED')
    expect((visionOf(noData, 'gemini') as { reason: string }).reason).toMatch(/--vision-dataset/)
  })

  it('the vision model is the configured one: AI_EVAL_<P>_VISION_MODEL, else AI_VISION_MODEL for the matching provider only', () => {
    expect(configuredVisionModel('gemini', {})).toBeNull()
    expect(configuredVisionModel('gemini', { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'text' })).toBeNull()
    expect(configuredVisionModel('openai', { AI_VISION_PROVIDER: 'OpenAI', AI_VISION_MODEL: 'v' })).toBe('v')
    expect(configuredVisionModel('gemini', { AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'v' })).toBeNull()
    expect(configuredVisionModel('gemini', { AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_VISION_PROVIDER: 'gemini', AI_VISION_MODEL: 'v' })).toBe('gv')
  })
})

describe('bake-off vision: live section (scripted provider, app pipeline)', () => {
  const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gemini-vision-test' }

  it('reports model, dataset version, cases, schema validity, accuracy, failures, timeouts and latency', async () => {
    const r = await buildBakeoff(env, { visionDataset: dir, providers: { vision: () => scriptedVision('timeout', 5) } })
    const v = visionOf(r, 'gemini') as VisionSummary
    expect(v).toMatchObject({ status: 'TESTED', provider: 'gemini', model: 'gemini-vision-test', datasetVersion: 'synthetic-test-v1', cases: 3, passed: 2, failed: 1, failures: 1, timeouts: 1 })
    expect(v.schemaValidity).toBeCloseTo(2 / 3, 3)
    expect(v.subjectAccuracy).toBeCloseTo(2 / 3, 3)
    expect([v.categoryAccuracy, v.primaryColorAccuracy]).toEqual([1, 1])
    expect([v.falseRejectionRate, v.falseAcceptanceRate]).toEqual([0, 0])
    expect(v.errorRate).toBeCloseTo(1 / 3, 3)
    // Latency comes from the section accounting: 3 samples give a p50 but no p95 (needs 20).
    const acct = r.live.find((l) => l.provider === 'gemini')!.accounting.find((a) => a.feature === 'vision')!
    expect(v.latencyP50).toBe(acct.latencyMs.p50)
    expect(v.latencyP50).toBeGreaterThanOrEqual(0)
    expect(v.latencyP95).toBeNull()
    expect(v.latencyMax).toBe(acct.latencyMs.max)
    expect(v.meanInputTokens).toBe(100)
    // Only vision measured for gemini: partially tested, so still no selection; openai has no key.
    const g = r.live.find((l) => l.provider === 'gemini')!
    expect(g.status).toBe('PARTIALLY_TESTED')
    expect(g.reason).toMatch(/no configured model/)
    expect(r.live.find((l) => l.provider === 'openai')!.status).toBe('NOT_TESTED')
    // Phase 5.1: a scripted provider is never a provider result.
    expect(r.execution.providerSource).toBe('TEST_ONLY')
    expect(r.recommendation).toMatch(/^NO FINAL PROVIDER SELECTED — TEST_ONLY RUN/)
  })

  it('an output breaking the contract counts against schema validity (not as a timeout)', async () => {
    const v = visionOf(await buildBakeoff(env, { visionDataset: dir, providers: { vision: () => scriptedVision('invalid') } }), 'gemini') as VisionSummary
    expect(v.invalidRate).toBeCloseTo(1 / 3, 3)
    expect([v.failures, v.timeouts]).toEqual([1, 0])
    expect(v.schemaValidity).toBeCloseTo(2 / 3, 3)
  })

  it('a provider error other than a timeout is a failure, not a timeout', async () => {
    const v = visionOf(await buildBakeoff(env, { visionDataset: dir, providers: { vision: () => scriptedVision('unavailable') } }), 'gemini') as VisionSummary
    expect([v.failures, v.timeouts]).toEqual([1, 0])
    expect(v.errorRate).toBeCloseTo(1 / 3, 3)
  })

  it('a garment where the label says unclear is a false acceptance', async () => {
    const v = visionOf(await buildBakeoff(env, { visionDataset: dir, providers: { vision: () => scriptedVision('garment') } }), 'gemini') as VisionSummary
    expect(v.falseAcceptanceRate).toBe(0.5)
    expect(v.schemaValidity).toBe(1)
  })

  it('all features of both providers measured → TESTED and the gates apply (never an automatic selection)', async () => {
    const full = { GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g', AI_EVAL_OPENAI_MODEL: 'o', AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_OPENAI_VISION_MODEL: 'ov' }
    const r = await buildBakeoff(full, { visionDataset: dir, providers: { llm: scriptedLlm, vision: () => scriptedVision('garment') } })
    expect(r.live.map((l) => [l.provider, l.status, l.reason])).toEqual([['gemini', 'TESTED', null], ['openai', 'TESTED', null]])
    // Phase 5.1: injected scripted providers → TEST_ONLY, never "results available"; still no selection.
    expect(r.recommendation).toMatch(/^NO FINAL PROVIDER SELECTED — TEST_ONLY RUN/)
    expect(r.recommendation).not.toMatch(/APPLY THE GATES/)
    expect(JSON.stringify(r)).not.toContain(FAKE)
    // One provider fully measured is not enough for the gates.
    const oneSide = await buildBakeoff({ ...full, OPENAI_API_KEY: '' }, { visionDataset: dir, providers: { llm: scriptedLlm, vision: () => scriptedVision('garment') } })
    expect(oneSide.live.map((l) => l.status)).toEqual(['TESTED', 'NOT_TESTED'])
    expect(oneSide.recommendation).not.toMatch(/APPLY THE GATES/)
    // The rule itself (real providers): only both fully TESTED points to the gates — and never names a provider.
    const l = (status: 'TESTED' | 'NOT_TESTED' | 'PARTIALLY_TESTED') => ({ status }) as never
    expect(recommend([l('TESTED'), l('TESTED')], false)).toMatch(/^NO FINAL PROVIDER SELECTED — LIVE RESULTS AVAILABLE; APPLY THE GATES/)
    expect(recommend([l('TESTED'), l('PARTIALLY_TESTED')], false)).toBe(NO_SELECTION)
    expect(recommend([l('TESTED'), l('NOT_TESTED')], false)).toBe(NO_SELECTION)
    expect(recommend([l('NOT_TESTED'), l('NOT_TESTED')], true)).toBe(NO_SELECTION)
    expect(recommend([l('TESTED'), l('TESTED')], false)).not.toMatch(/gemini|openai/i)
  })
})

describe('bake-off --runs', () => {
  const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv' }

  it('default (1 run): no runs/aggregate fields, the existing shape', async () => {
    const r = await buildBakeoff({})
    expect(r.runs).toBeUndefined()
    expect(r.aggregate).toBeUndefined()
    // Phase 5.0 keys are all kept; Phase 5.1 only adds sections.
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['harnessVersion', 'live', 'offline', 'recommendation']))
    expect(r.providerDecision).toBe('NO FINAL PROVIDER SELECTED')
  })

  it('3 runs: every run kept and numbered, live = run 1, aggregate mean/min/max/spread over TESTED runs only', async () => {
    let n = 0
    // Run 2 times out on the third item; runs 1 and 3 accept it: subject accuracy differs between runs.
    const r = await buildBakeoff(env, { visionDataset: dir, runs: 3, providers: { vision: () => scriptedVision(++n === 2 ? 'timeout' : 'garment') } })
    expect(r.runs!.map((x) => x.run)).toEqual([1, 2, 3])
    expect(r.live).toBe(r.runs![0].live)
    const timeouts = r.runs!.map((x) => (visionOf({ ...r, live: x.live }, 'gemini') as VisionSummary).timeouts)
    expect(timeouts).toEqual([0, 1, 0])
    const g = r.aggregate!.find((a) => a.provider === 'gemini' && a.feature === 'vision')!
    expect(g.testedRuns).toBe(3)
    expect(g.metrics.timeouts).toEqual({ n: 3, mean: 0.3333, min: 0, max: 1, spread: 1 })
    expect(g.metrics.schemaValidity.min).toBeCloseTo(2 / 3, 3)
    expect(g.metrics.schemaValidity.max).toBe(1)
    // NOT_TESTED sections are not averaged into anything.
    expect(r.aggregate!.find((a) => a.provider === 'openai' && a.feature === 'vision')).toEqual({ provider: 'openai', feature: 'vision', testedRuns: 0, metrics: {}, pooledLatencyMs: { n: 0, p50: null, p95: null, p99: null, max: null } })
    expect(r.aggregate!.find((a) => a.provider === 'gemini' && a.feature === 'stylist')!.testedRuns).toBe(0)
  })

  it.each([0, -1, 1.5, MAX_RUNS + 1, Number.NaN])('runs=%s is refused', async (runs) => {
    await expect(buildBakeoff({}, { runs })).rejects.toThrow(/runs must be a whole number/)
  })

  it('aggregateRuns: single value has zero spread; non-numeric fields are ignored', () => {
    const live = [{ provider: 'gemini' as const, status: 'TESTED' as const, model: 'm', visionModel: null, reason: null, accounting: [], failures: [], features: [{ status: 'TESTED', feature: 'outfit', provider: 'gemini', model: 'm', latencyP50: 120, note: 'x' } as never] }]
    const a = aggregateRuns([{ run: 1, live }])
    expect(a.find((x) => x.provider === 'gemini' && x.feature === 'outfit')!.metrics).toEqual({ latencyP50: { n: 1, mean: 120, min: 120, max: 120, spread: 0 } })
  })
})

describe('bake-off latency: one canonical source (accounting latencyStats)', () => {
  // The 15 per-case latencies of the 2026-10-07 Gemini Vision smoke test.
  const smoke = [11508, 5815, 3408, 5615, 5987, 5120, 7392, 4211, 7526, 4411, 4491, 6397, 6026, 4288, 3787]
  const accounting = (latencies: number[]) => [{ feature: 'vision', successRate: 1, failureRate: 0, timeouts: 0, attempts: latencies.length, attemptErrors: {}, retries: 0, corrections: 0, circuitBreakCases: 0, tokens: { input: 0, output: 0, total: 0, attemptsReporting: 0 }, costUsd: 'COST_UNAVAILABLE', latenciesMs: latencies, latencyMs: latencyStats(latencies) } as unknown as SectionAccounting]
  // What the vision scorer reports on its own: nearest-rank without a sample threshold, so p95 = max at n = 15.
  const scored = { status: 'TESTED', provider: 'gemini', model: 'm', feature: 'vision', latencyP50: 5615, latencyP95: 11508, latencyMax: 11508 } as unknown as VisionSummary

  it('n = 15: p50 stays, p95 and p99 are null, max stays 11508', () => {
    expect(latencyStats(smoke)).toEqual({ n: 15, p50: 5615, p95: null, p99: null, max: 11508 })
    const v = withAccountedLatency(scored, accounting(smoke)) as VisionSummary
    expect([v.latencyP50, v.latencyP95, v.latencyMax]).toEqual([5615, null, 11508])
  })

  it('the comparison / markdown never shows the maximum as p95', () => {
    const v = withAccountedLatency(scored, accounting(smoke))
    const notTested = (feature: 'stylist' | 'outfit') => ({ status: 'NOT_TESTED', provider: 'gemini', model: null, feature, reason: 'x' }) as never
    const live = [
      { provider: 'gemini' as const, status: 'PARTIALLY_TESTED' as const, model: null, visionModel: 'm', reason: null, accounting: accounting(smoke), failures: [], features: [v, notTested('stylist'), notTested('outfit')] },
      { provider: 'openai' as const, status: 'NOT_TESTED' as const, model: null, visionModel: null, reason: 'x', accounting: [], failures: [], features: [] as never[] },
    ]
    const openaiFeatures = (['vision', 'stylist', 'outfit'] as const).map((feature) => ({ status: 'NOT_TESTED', provider: 'openai', model: null, feature, reason: 'x' }) as never)
    live[1].features = openaiFeatures
    const rows = compare(live as never)
    const p95 = rows.find((r) => r.dimension === 'Latency p95')!.gemini
    expect(p95).not.toContain('11508')
    expect(p95).toMatch(/^V N\/A/)
    expect(rows.find((r) => r.dimension === 'Latency p50')!.gemini).toMatch(/^V 5615 ms/)
  })

  it('a large enough sample still yields the existing nearest-rank p95 / p99', () => {
    const big = Array.from({ length: 100 }, (_, i) => (i + 1) * 10)
    expect(latencyStats(big)).toEqual({ n: 100, p50: 500, p95: 950, p99: 990, max: 1000 })
    const v = withAccountedLatency(scored, accounting(big)) as VisionSummary
    expect([v.latencyP50, v.latencyP95, v.latencyMax]).toEqual([500, 950, 1000])
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(latencyStats(twenty)).toMatchObject({ p95: 19, p99: null, max: 20 })
  })

  it('a NOT_TESTED feature or one without accounting is left as is', () => {
    const nt = { status: 'NOT_TESTED', provider: 'gemini', model: null, feature: 'vision', reason: 'x', latencyP50: null, latencyP95: null } as never
    expect(withAccountedLatency(nt, accounting(smoke))).toBe(nt)
    expect(withAccountedLatency(scored, [])).toBe(scored)
  })
})
