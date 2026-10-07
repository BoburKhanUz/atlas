/**
 * Phase 5.0 bake-off: the live vision section, NOT_TESTED semantics and
 * repeated runs (--runs). Scripted providers only: no network, no keys (the
 * key variables hold an obviously fake value so the gating is exercised).
 */
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aggregateRuns, buildBakeoff, configuredVisionModel, MAX_RUNS, NO_SELECTION, type VisionSummary } from '../../../scripts/ai-eval/bakeoff'
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

/** Answers the dataset in order: jeans right, landscape right, then the scripted third outcome. */
function scriptedVision(third: 'timeout' | 'unavailable' | 'invalid' | 'garment', latencyMs = 0): VisionProvider & { calls: number } {
  return {
    name: 'scripted-vision',
    model: 'scripted',
    calls: 0,
    async analyzeImage(_req: VisionRequest) {
      const i = this.calls++
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs))
      if (i === 2 && (third === 'timeout' || third === 'unavailable')) throw new AiProviderError(third, 'scripted-vision')
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
    expect(v.latencyP50).toBeGreaterThanOrEqual(0)
    expect(v.latencyP95).toBeGreaterThanOrEqual(v.latencyP50)
    expect(v.meanInputTokens).toBe(100)
    // Only vision measured for gemini: partially tested, so still no selection; openai has no key.
    const g = r.live.find((l) => l.provider === 'gemini')!
    expect(g.status).toBe('PARTIALLY_TESTED')
    expect(g.reason).toMatch(/no configured model/)
    expect(r.live.find((l) => l.provider === 'openai')!.status).toBe('NOT_TESTED')
    expect(r.recommendation).toBe(NO_SELECTION)
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
    expect(r.recommendation).not.toBe(NO_SELECTION)
    expect(r.recommendation).toMatch(/APPLY THE GATES/)
    expect(JSON.stringify(r)).not.toContain(FAKE)
    // One provider fully measured is not enough for the gates.
    const oneSide = await buildBakeoff({ ...full, OPENAI_API_KEY: '' }, { visionDataset: dir, providers: { llm: scriptedLlm, vision: () => scriptedVision('garment') } })
    expect(oneSide.live.map((l) => l.status)).toEqual(['TESTED', 'NOT_TESTED'])
    expect(oneSide.recommendation).toBe(NO_SELECTION)
  })
})

describe('bake-off --runs', () => {
  const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv' }

  it('default (1 run): no runs/aggregate fields, the existing shape', async () => {
    const r = await buildBakeoff({})
    expect(r.runs).toBeUndefined()
    expect(r.aggregate).toBeUndefined()
    expect(Object.keys(r)).toEqual(['harnessVersion', 'live', 'offline', 'recommendation'])
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
    expect(r.aggregate!.find((a) => a.provider === 'openai' && a.feature === 'vision')).toEqual({ provider: 'openai', feature: 'vision', testedRuns: 0, metrics: {} })
    expect(r.aggregate!.find((a) => a.provider === 'gemini' && a.feature === 'stylist')!.testedRuns).toBe(0)
  })

  it.each([0, -1, 1.5, MAX_RUNS + 1, Number.NaN])('runs=%s is refused', async (runs) => {
    await expect(buildBakeoff({}, { runs })).rejects.toThrow(/runs must be a whole number/)
  })

  it('aggregateRuns: single value has zero spread; non-numeric fields are ignored', () => {
    const live = [{ provider: 'gemini' as const, status: 'TESTED' as const, model: 'm', visionModel: null, reason: null, features: [{ status: 'TESTED', feature: 'outfit', provider: 'gemini', model: 'm', latencyP50: 120, note: 'x' } as never] }]
    const a = aggregateRuns([{ run: 1, live }])
    expect(a.find((x) => x.provider === 'gemini' && x.feature === 'outfit')!.metrics).toEqual({ latencyP50: { n: 1, mean: 120, min: 120, max: 120, spread: 0 } })
  })
})
