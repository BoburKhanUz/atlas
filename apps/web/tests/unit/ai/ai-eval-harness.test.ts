/**
 * Phase 4.5 evaluation harness (scripts/ai-eval): the pure scoring, the
 * synthetic datasets and an offline run of the stylist and outfit runners
 * with scripted providers. No network, no keys.
 */
import { describe, expect, it } from 'vitest'
import path from 'path'
import { inventedGarments, kendallTau, leaksPrivate, llmProviderFromEnv, assertOutsideRepo, percentile, uzbekCheck } from '../../../scripts/ai-eval/eval-common'
import { stylistCases } from '../../../scripts/ai-eval/stylist-cases'
import { requestIsClean, scoreStylist, summarizeStylist, type StylistOutcome } from '../../../scripts/ai-eval/stylist-scoring'
import { runRobustness } from '../../../scripts/ai-eval/robustness'
import { buildBakeoff, configuredModel, NO_SELECTION } from '../../../scripts/ai-eval/bakeoff'
import { runStylistCase, ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { outfitCases } from '../../../scripts/ai-eval/outfit-cases'
import { scoreOutfit } from '../../../scripts/ai-eval/outfit-scoring'
import { fallbackExplanations, runOutfitCase, ScriptedOutfit } from '../../../scripts/ai-eval/outfit-eval'
import { renderSynthetic, syntheticVisionItems } from '../../../scripts/ai-eval/synthetic-vision'
import { Dataset } from '../../../scripts/ai-eval/vision-scoring'
import { COLORS, SUBCATEGORIES } from '@/lib/ai/catalog'
import { CONFIDENCE_KEYS, presentConfidences, UNCALIBRATED_MAX_CONFIDENCE } from '@/lib/ai/garment-analysis'
import { analyzeClothing } from '@/lib/ai/mock-vision'
import { generateOutfitResult } from '@/lib/ai/outfit-engine'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'

const scripted = (texts: Array<(req: LLMRequest) => string>): LLMProvider & { calls: number } => {
  const p = {
    name: 'scripted-test',
    model: 'm',
    calls: 0,
    async generate(req: LLMRequest) {
      const text = texts[Math.min(p.calls, texts.length - 1)](req)
      p.calls++
      return { text, metadata: { provider: 'scripted-test', model: 'm', usage: { inputTokens: 100, outputTokens: 20 } } }
    },
  }
  return p
}

describe('common scoring helpers', () => {
  it('percentile (nearest rank) and Kendall tau', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5)
    expect(percentile([], 50)).toBeNull()
    expect(kendallTau(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1)
    expect(kendallTau(['c', 'b', 'a'], ['a', 'b', 'c'])).toBe(-1)
    expect(kendallTau(['b', 'a', 'c'], ['a', 'b', 'c'])).toBeCloseTo(0.333, 3)
    expect(kendallTau(['a', 'x'], ['a', 'b'])).toBeNull()
  })

  it('Uzbek check: Latin Uzbek passes; English, Cyrillic or marker-free text fails', () => {
    expect(uzbekCheck('Bugun oq ko‘ylak va to‘q ko‘k shim kiying, bu sizga mos.').pass).toBe(true)
    expect(uzbekCheck('Wear the white shirt with the navy trousers today.').pass).toBe(false)
    expect(uzbekCheck('Бугун оқ кўйлак кийинг').latin).toBe(false)
    expect(uzbekCheck('Futbolka krossovka jins palto').uzbek).toBe(false)
    // Uzbek markers present, but a large share of English: still fails (code-switching is not acceptable output).
    const mixed = uzbekCheck('Bugun wear the white shirt and the navy trousers, bu sizga mos va yaxshi.')
    expect(mixed.uzbek).toBe(true)
    expect(mixed.englishShare).toBeGreaterThan(0.05)
    expect(mixed.pass).toBe(false)
  })

  it('invented garments: names not owned are flagged unless allowed for the case', () => {
    const owned = new Set(['tshirt', 'jeans'])
    expect(inventedGarments('Oq futbolka va ko‘k jins kiying.', owned)).toEqual([])
    expect(inventedGarments('Qora kurtka va galstuk qo‘shing.', owned)).toEqual(['kurtka', 'galstuk'])
    expect(inventedGarments('Garderobingizda kostyum yo‘q.', owned, ['kostyum'])).toEqual([])
  })

  it('private identifiers and prompt fragments are detected', () => {
    expect(leaksPrivate('id: item_abc123')).toBe(true)
    expect(leaksPrivate('cmuwlc6tf002f7dk410qks1fk')).toBe(true)
    expect(leaksPrivate('You are ATLAS, a stylist')).toBe(true)
    expect(leaksPrivate('Oq futbolka kiying.')).toBe(false)
  })

  it('providers come only from the environment: no default model, no key → error before any call', () => {
    expect(() => llmProviderFromEnv('gemini', undefined, { GEMINI_API_KEY: 'k' })).toThrow(/model must be set/)
    expect(() => llmProviderFromEnv('openai', 'some-model', {})).toThrow(/OPENAI_API_KEY is not set/)
    expect(() => llmProviderFromEnv(undefined, undefined, {})).toThrow(/provider must be gemini or openai/)
    const p = llmProviderFromEnv(undefined, undefined, { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'configured-model', GEMINI_API_KEY: 'k' })
    expect([p.name, p.model]).toEqual(['gemini', 'configured-model'])
  })

  it('results must be written outside the repository', () => {
    const repo = path.resolve(__dirname, '../../../../..')
    expect(() => assertOutsideRepo(path.join(repo, 'apps/web/out'), repo, path)).toThrow(/outside the repository/)
    expect(() => assertOutsideRepo('/tmp/eval-out', repo, path)).not.toThrow()
  })
})

describe('stylist evaluation', () => {
  it('cases are deterministic, cover the required scenarios and use catalog values only', () => {
    const a = stylistCases(), b = stylistCases()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length)
    for (const id of ['casual', 'work', 'wedding', 'date', 'travel', 'weather_rain_cold', 'color_profile', 'wardrobe_limited', 'no_suitable_item', 'injection_ignore_rules', 'nonexistent_item']) {
      expect(a.map((c) => c.id)).toContain(id)
    }
    const colors = new Set(COLORS.map((c) => c.id))
    // Every wardrobe is catalog-valued except the deliberately tampered injection case.
    for (const c of a.filter((x) => x.id !== 'injection_wardrobe_values')) for (const w of c.wardrobe) {
      expect(SUBCATEGORIES[w.category].some((s) => s.id === w.subcategory)).toBe(true)
      expect(w.colors.every((x) => colors.has(x))).toBe(true)
    }
  })

  it('scoring: hallucination, private leak, reference range, needsMoreInfo and weather claims fail a case', () => {
    const owned = new Set(['tshirt', 'jeans'])
    const ans = (shown: string, extra: Partial<Extract<StylistOutcome, { kind: 'answer' }>> = {}): StylistOutcome => ({ kind: 'answer', firstError: null, raw: shown, shown, refs: ['W1', 'W2'], needsMoreInfo: false, ...extra })
    expect(scoreStylist({ minRefs: 2 }, ans('Bugun oq futbolka va ko‘k jins kiying, bu sizga mos.'), owned).pass).toBe(true)
    expect(scoreStylist({}, ans('Bugun qora kurtka kiying, bu sizga mos.'), owned).checks.inventedGarments).toEqual(['kurtka'])
    expect(scoreStylist({}, ans('item_123 ni kiying va bu sizga mos.'), owned).checks.noPrivateLeak).toBe(false)
    expect(scoreStylist({ maxRefs: 1 }, ans('Bugun oq futbolka kiying, bu sizga mos.'), owned).pass).toBe(false)
    expect(scoreStylist({ needsMoreInfo: true }, ans('Bugun oq futbolka kiying, bu sizga mos.'), owned).pass).toBe(false)
    expect(scoreStylist({ noWeatherClaims: true }, ans('Bugun harorat past, oq futbolka kiying va bu sizga mos.'), owned).pass).toBe(false)
    expect(scoreStylist({}, { kind: 'invalid', firstError: 'schema' }, owned).pass).toBe(false)
  })

  it('offline run (scripted provider): every case goes through the production path and validates', async () => {
    const p = new ScriptedStylist()
    const records: Awaited<ReturnType<typeof runStylistCase>>[] = []
    for (const c of stylistCases()) records.push(await runStylistCase(p, c))
    const s = summarizeStylist(records)
    expect(s.cases).toBe(stylistCases().length)
    expect(s.finalValidity).toBe(1)
    expect(s.groundingRate).toBe(1)
    expect(s.injectionResistance).toBe(1)
    expect(records.find((r) => r.case === 'empty_wardrobe')!.pass).toBe(true)
    expect(s.relevanceRate!).toBeLessThan(1) // the naive scripted answer is NOT on topic everywhere: the rubric discriminates
  })

  it('an ungrounded first answer triggers exactly the production correction, then is accepted', async () => {
    const good = (req: LLMRequest) => {
      const refs = (req.jsonSchema!.schema as { properties: { referencedItems: { items: { enum: string[] } } } }).properties.referencedItems.items.enum
      return JSON.stringify({ answer: `Bugun [${refs[0]}] kiying, bu sizga mos.`, referencedItems: [refs[0]], needsMoreInfo: false })
    }
    const p = scripted([() => JSON.stringify({ answer: '[W99] kiying.', referencedItems: ['W99'], needsMoreInfo: false }), good])
    const r = await runStylistCase(p, stylistCases()[0])
    expect(p.calls).toBe(2)
    expect(r.outcome).toMatchObject({ kind: 'answer', firstError: 'invalid_reference' })
    expect([r.inputTokens, r.outputTokens]).toEqual([200, 40])
  })

  it('malformed output is an "invalid" outcome (the user would get AI_UNAVAILABLE), not a crash', async () => {
    const r = await runStylistCase(scripted([() => 'not json']), stylistCases()[0])
    expect(r.outcome).toEqual({ kind: 'invalid', firstError: 'schema' })
    expect(r.pass).toBe(false)
  })
})

describe('outfit evaluation', () => {
  it('cases are deterministic and every case yields engine candidates', () => {
    expect(JSON.stringify(outfitCases())).toBe(JSON.stringify(outfitCases()))
    for (const c of outfitCases()) expect(generateOutfitResult({ wardrobe: c.wardrobe, occasion: c.occasion, weather: c.weather, colorProfile: c.colorProfile, topN: c.topN }).outfits.length).toBeGreaterThan(1)
  })

  it('offline run: all valid; an invalid answer twice ends as "invalid" (the app falls back)', async () => {
    for (const c of outfitCases()) expect((await runOutfitCase(new ScriptedOutfit(), c)).pass).toBe(true)
    const bad = scripted([() => JSON.stringify({ selectedCandidate: 'O9', ranking: ['O9'], explanation: 'x', needsMoreInfo: false })])
    const r = await runOutfitCase(bad, outfitCases()[0])
    expect(bad.calls).toBe(2)
    expect(r.outcome).toMatchObject({ kind: 'invalid', firstError: 'unknown_selected' })
  })

  it('scoring: weather and profile claims without data, references and invented garments fail', () => {
    const c = outfitCases().find((x) => x.id === 'profile_none')!
    const candidates = generateOutfitResult({ wardrobe: c.wardrobe, occasion: c.occasion, colorProfile: null, topN: 5 }).outfits
    const refs = candidates.map((_, i) => `O${i + 1}`)
    const ctx = { candidates, weatherProvided: false, profileSent: false, profileStrong: false }
    const ok = (explanation: string) => scoreOutfit(ctx, { kind: 'ranked', firstError: null, ranking: refs, explanation })
    expect(ok('Bu obraz qulay va ranglari bir-biriga mos.').pass).toBe(true)
    expect(ok('Bu obraz rang profilingizga mos.').checks.noUnsupportedClaims).toBe(false)
    expect(ok('Bugungi harorat uchun bu obraz mos.').checks.noUnsupportedClaims).toBe(false)
    expect(ok('O2 eng yaxshisi va bu sizga mos.').checks.noPrivateLeak).toBe(false)
    expect(ok('Bu obrazga galstuk qo‘shing va bu mos.').checks.explanationGrounded).toBe(false)
  })

  it('the deterministic fallback explanations are grounded Latin Uzbek (no English occasion label)', () => {
    for (const { case: id, explanation } of fallbackExplanations()) {
      const check = uzbekCheck(explanation)
      expect(check.pass, `${id}: ${explanation}`).toBe(true)
      expect(explanation).not.toMatch(/Casual|«/)
    }
  })
})

describe('synthetic vision dataset', () => {
  it('valid for the vision harness, neutral ids, covering every required case', () => {
    const items = syntheticVisionItems()
    const ds = Dataset.parse({ items: items.map(({ id, file, expected }) => ({ id, file, expected })) })
    const cats = new Set(ds.items.map((i) => i.expected.category))
    for (const c of ['shirt', 'outerwear', 'pants', 'dress', 'shoes', 'accessory']) expect(cats).toContain(c)
    const subjects = new Set(ds.items.map((i) => i.expected.subject))
    for (const s of ['single_garment', 'multiple_garments', 'no_garment', 'unclear']) expect(subjects).toContain(s)
    for (const sub of ['tshirt', 'coat', 'jeans']) expect(ds.items.map((i) => i.expected.subcategory)).toContain(sub)
  })

  it('renders deterministically', async () => {
    const [a] = syntheticVisionItems()
    expect((await renderSynthetic(a)).equals(await renderSynthetic(a))).toBe(true)
    const tiny = syntheticVisionItems().find((i) => i.degrade === 'tiny')!
    expect((await renderSynthetic(tiny)).length).toBeGreaterThan(0)
  })
})

describe('injection through stored data, weather and occasion (request-level check)', () => {
  it('requestIsClean: the marker may appear only in user turns', () => {
    expect(requestIsClean([{ role: 'system', content: 'rules' }, { role: 'user', content: 'X-MARK' }], 'X-MARK')).toBe(true)
    expect(requestIsClean([{ role: 'system', content: 'ctx X-MARK' }, { role: 'user', content: 'hi' }], 'X-MARK')).toBe(false)
    expect(requestIsClean([{ role: 'system', content: 'x' }], undefined)).toBeNull()
    // A planted marker in the context fails the case even when the answer itself looks fine.
    const answer: StylistOutcome = { kind: 'answer', firstError: null, raw: 'Bugun oq futbolka kiying, bu sizga mos.', shown: 'Bugun oq futbolka kiying, bu sizga mos.', refs: ['W1'], needsMoreInfo: false }
    expect(scoreStylist({}, answer, new Set(['tshirt']), true).pass).toBe(true)
    expect(scoreStylist({}, answer, new Set(['tshirt']), false).pass).toBe(false)
  })

  it('tampered wardrobe values and weather/occasion text never reach the system or context messages', async () => {
    for (const id of ['injection_wardrobe_values', 'injection_weather_occasion']) {
      const r = await runStylistCase(new ScriptedStylist(), stylistCases().find((c) => c.id === id)!)
      expect(r.checks.requestClean, id).toBe(true)
    }
  })
})

describe('adversarial robustness suite (offline)', () => {
  it('every scenario ends exactly as specified: grounded answer, refusal or deterministic fallback; never more than 2 calls', async () => {
    const results = await runRobustness()
    expect(results.length).toBeGreaterThanOrEqual(13)
    for (const r of results) {
      expect(r.actual, `${r.feature}: ${r.scenario}`).toBe(r.expected)
      expect(r.calls).toBeLessThanOrEqual(2)
    }
    expect(results.filter((r) => r.scenario.startsWith('malformed JSON (never retried)'))[0].calls).toBe(1)
  })
})

describe('bake-off report', () => {
  it('without credentials: both providers NOT_TESTED, every live metric null, no selection; deterministic', async () => {
    const env = { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'configured-model' } // a model but no key
    const a = await buildBakeoff(env)
    expect(a.live.map((l) => [l.provider, l.status])).toEqual([['gemini', 'NOT_TESTED'], ['openai', 'NOT_TESTED']])
    for (const l of a.live) for (const f of l.features) {
      expect(f.status).toBe('NOT_TESTED')
      expect([f.schemaValidity, f.groundingRate, f.latencyP50, f.latencyP95]).toEqual([null, null, null, null])
    }
    expect(a.live[0].reason).toMatch(/no GEMINI_API_KEY/)
    expect(a.recommendation).toBe(NO_SELECTION)
    expect(a.offline.stylist.status).toBe('OFFLINE_SELF_TEST')
    expect([a.offline.stylist.latencyP50, a.offline.outfit.latencyP95]).toEqual([null, null]) // no fake latency
    expect(a.offline.robustness.failed).toBe(0)
    expect(JSON.stringify(await buildBakeoff(env))).toBe(JSON.stringify(a))
  })

  it('the model is always the configured one (never a built-in default)', () => {
    expect(configuredModel('gemini', {})).toBeNull()
    expect(configuredModel('openai', { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g' })).toBeNull()
    expect(configuredModel('gemini', { AI_LLM_PROVIDER: 'Gemini', AI_LLM_MODEL: 'g' })).toBe('g')
    expect(configuredModel('openai', { AI_EVAL_OPENAI_MODEL: 'o' })).toBe('o')
  })
})

describe('confidence behaviour on synthetic fixtures (no calibration claimed)', () => {
  it('real-provider confidences shown to users never exceed the uncalibrated cap; a colour conflict lowers colour further', () => {
    for (const raw of [0, 0.3, 0.69, 0.7, 0.95, 1]) {
      const shown = presentConfidences(Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, raw])) as never, null)
      for (const k of CONFIDENCE_KEYS) expect(shown[k]).toBe(Math.min(raw, UNCALIBRATED_MAX_CONFIDENCE))
      expect(presentConfidences(Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, raw])) as never, 0.4).color).toBe(Math.min(raw, 0.4))
    }
  })

  it('observation: the deterministic MOCK vision (development/demo only) reports colour confidence above that cap', async () => {
    const values: number[] = []
    for (const item of syntheticVisionItems().slice(0, 4)) values.push((await analyzeClothing({ buffer: await renderSynthetic(item), filename: item.file })).confidence.color)
    expect(Math.max(...values)).toBeGreaterThan(UNCALIBRATED_MAX_CONFIDENCE) // documented in provider-evaluation.md; production refuses the mock
  })
})
