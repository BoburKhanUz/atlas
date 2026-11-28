/**
 * The harness's offline self-test on the Go pipeline (moved from
 * tests/unit/ai/ai-eval-harness.test.ts in B7.4f): the robustness scenarios
 * and the bake-off report without credentials.
 */
import { describe, expect, it } from 'vitest'
import { buildBakeoff, NO_SELECTION } from '../../scripts/ai-eval/bakeoff'
import { runRobustness } from '../../scripts/ai-eval/robustness'

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

