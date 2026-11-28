/**
 * The harness's offline self-test on the Go pipeline (moved from
 * tests/unit/ai/ai-eval-harness.test.ts in B7.4f): the robustness scenarios
 * and the bake-off report without credentials.
 */
import { describe, expect, it } from 'vitest'
import { buildBakeoff, NO_SELECTION } from '../../scripts/ai-eval/bakeoff'
import { goRunners, runRobustness } from '../../scripts/ai-eval/robustness'
import { outfitCases } from '../../scripts/ai-eval/outfit-cases'
import { ScriptedOutfit } from '../../scripts/ai-eval/outfit-eval'
import type { LLMProvider, LLMRequest } from '../../scripts/ai-eval/protocol'
import { stylistCases } from '../../scripts/ai-eval/stylist-cases'
import { ScriptedStylist } from '../../scripts/ai-eval/stylist-eval'
import { summarizeStylist, type StylistRecord } from '../../scripts/ai-eval/stylist-scoring'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

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

})


/** A text provider that plays `texts` in order (the last repeats), reporting usage. */
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

const run = goRunners()

describe('offline runs on the Go pipeline (moved from tests/unit/ai/ai-eval-harness.test.ts)', () => {
  it('offline run (scripted provider): every case goes through the production path and validates', async () => {
    const p = new ScriptedStylist()
    const records: StylistRecord[] = []
    for (const c of stylistCases()) records.push(await run.stylist(p, c))
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
    const r = await run.stylist(p, stylistCases()[0])
    expect(p.calls).toBe(2)
    expect(r.outcome).toMatchObject({ kind: 'answer', firstError: 'invalid_reference' })
    expect([r.inputTokens, r.outputTokens]).toEqual([200, 40])
  })

  it('malformed output is refused by the provider layer (the user gets AI_UNAVAILABLE; owner decision 2026-11-28), not a crash', async () => {
    const r = await run.stylist(scripted([() => 'not json']), stylistCases()[0])
    expect(r.outcome).toEqual({ kind: 'error', error: 'malformed_response' })
    expect(r.pass).toBe(false)
  })

  it('offline run: all valid; an invalid answer twice ends as "invalid" (the app falls back)', async () => {
    for (const c of outfitCases()) expect((await run.outfit(new ScriptedOutfit(), c)).pass).toBe(true)
    const bad = scripted([() => JSON.stringify({ selectedCandidate: 'O9', ranking: ['O9'], explanation: 'x', needsMoreInfo: false })])
    const r = await run.outfit(bad, outfitCases()[0])
    expect(bad.calls).toBe(2)
    expect(r.outcome).toMatchObject({ kind: 'invalid', firstError: 'unknown_selected' })
  })

  it('tampered wardrobe values and weather/occasion text never reach the system or context messages', async () => {
    for (const id of ['injection_wardrobe_values', 'injection_weather_occasion']) {
      const r = await run.stylist(new ScriptedStylist(), stylistCases().find((c) => c.id === id)!)
      expect(r.checks.requestClean, id).toBe(true)
    }
  })
})
