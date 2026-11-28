/**
 * The offline evaluation against Go (stage B6.9): every scripted case of
 * the harness runs through the TypeScript pipeline and through `lookly
 * eval` (served the same scripted provider by a stand-in on 127.0.0.1), and
 * both must give the same record: outcome, checks, pass, calls, requests,
 * tokens. Only the latency differs.
 */
import { describe, expect, it } from 'vitest'
import { GoPipeline, serveStandIn } from '../../scripts/ai-eval/go-pipeline'
import { outfitCases } from '../../scripts/ai-eval/outfit-cases'
import { runOutfitCase, runOutfitCaseGo, ScriptedOutfit } from '../../scripts/ai-eval/outfit-eval'
import { runRobustness } from '../../scripts/ai-eval/robustness'
import { stylistCases } from '../../scripts/ai-eval/stylist-cases'
import { runStylistCase, runStylistCaseGo, ScriptedStylist } from '../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../scripts/ai-eval/synthetic-vision'
import { runOne, runOneGo } from '../../scripts/ai-eval/vision-eval'
import { AiProviderError, type AiErrorKind } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest, VisionProvider, VisionRequest } from '@/lib/ai/providers/types'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

async function withGo<T>(text: LLMProvider | null, vision: VisionProvider | null, model: string, fn: (go: GoPipeline) => Promise<T>, timeout = '10s'): Promise<T> {
  const standIn = await serveStandIn(text, vision)
  const go = new GoPipeline({ args: ['--provider=openai', `--model=${model}`, `--base-url=${standIn.url}`, `--timeout=${timeout}`] })
  try {
    return await fn(go)
  } finally {
    await go.close()
    await standIn.close()
  }
}

const withoutLatency = <T extends { latencyMs: number }>(r: T) => ({ ...r, latencyMs: 0 })

/**
 * A provider that records what it is asked (everything but the time limit,
 * which the stand-in does not see) and, when usage is given, reports it.
 */
function recording(p: LLMProvider, usage?: { inputTokens: number; outputTokens: number }) {
  const asked: unknown[] = []
  const provider: LLMProvider = {
    name: p.name, model: p.model,
    async generate(req: LLMRequest) {
      asked.push({ messages: req.messages, temperature: req.temperature, maxOutputTokens: req.maxOutputTokens, jsonSchema: req.jsonSchema })
      const r = await p.generate(req)
      return usage ? { ...r, metadata: { ...r.metadata, usage } } : r
    },
  }
  return { provider, asked }
}

describe('the evaluation on the Go pipeline', () => {
  it('every stylist case gives the TypeScript record', async () => {
    const cases = stylistCases()
    const tsSide = recording(new ScriptedStylist())
    const ts: unknown[] = []
    for (const c of cases) ts.push(withoutLatency(await runStylistCase(tsSide.provider, c)))
    const goSide = recording(new ScriptedStylist())
    const go = await withGo(goSide.provider, null, goSide.provider.model, async (g) => {
      const out: unknown[] = []
      for (const c of cases) out.push(withoutLatency(await runStylistCaseGo(g, goSide.provider, c)))
      return out
    })
    expect(go).toEqual(ts)
    // What the model is asked: the same messages, schema and settings.
    expect(goSide.asked).toEqual(tsSide.asked)
    expect(ts.length).toBeGreaterThan(10)
  })

  it('every outfit case gives the TypeScript record', async () => {
    const cases = outfitCases()
    const tsSide = recording(new ScriptedOutfit())
    const ts: unknown[] = []
    for (const c of cases) ts.push(withoutLatency(await runOutfitCase(tsSide.provider, c)))
    const goSide = recording(new ScriptedOutfit())
    const go = await withGo(goSide.provider, null, goSide.provider.model, async (g) => {
      const out: unknown[] = []
      for (const c of cases) out.push(withoutLatency(await runOutfitCaseGo(g, goSide.provider, c)))
      return out
    })
    expect(go).toEqual(ts)
    expect(goSide.asked).toEqual(tsSide.asked)
  })

  it('the robustness scenarios end the same, but where Go refuses a non-JSON answer itself', async () => {
    const ts = await runRobustness()
    const go = await runRobustness({
      stylist: (p, c) => withGo(p, null, p.model, (g) => runStylistCaseGo(g, p, c)),
      outfit: (p, c) => withGo(p, null, p.model, (g) => runOutfitCaseGo(g, p, c)),
    })
    // The Go OpenAI adapter refuses an answer that is not JSON when a schema
    // was asked (malformed_response, not retried, not corrected: B6.2): the
    // user gets the same AI_UNAVAILABLE or fallback either way.
    const adapterRefusals: Record<string, { actual: string; calls: number }> = {
      'stylist:malformed JSON (never retried)': { actual: 'error_malformed_response', calls: 1 },
      'outfit:malformed JSON twice': { actual: 'fallback_error_malformed_response', calls: 1 },
    }
    expect(go.map((r) => `${r.feature}:${r.scenario}`)).toEqual(ts.map((r) => `${r.feature}:${r.scenario}`))
    for (const [i, r] of go.entries()) {
      const known = adapterRefusals[`${r.feature}:${r.scenario}`]
      if (known) expect({ actual: r.actual, calls: r.calls }, r.scenario).toEqual(known)
      else expect({ actual: r.actual, calls: r.calls, pass: r.pass }, r.scenario).toEqual({ actual: ts[i].actual, calls: ts[i].calls, pass: ts[i].pass })
    }
  })

  it('a lookly eval that is gone refuses every case with its reason, and closes', async () => {
    // Go refuses its flags and exits at once: a case sent before and after that.
    const refused = new GoPipeline({ args: ['--provider=nobody'] })
    await expect(refused.run('stylist', {})).rejects.toThrow(/exited \(2\)[^]*--provider must be/)
    await expect(refused.run('stylist', {})).rejects.toThrow(/exited \(2\)/)
    await refused.close()
    // No such binary.
    const missing = new GoPipeline({ args: [], binary: '/nonexistent/lookly' })
    await expect(missing.run('stylist', {})).rejects.toThrow(/could not be started/)
    await missing.close()
  })

  it('each provider failure gives the TypeScript record', async () => {
    const kinds: AiErrorKind[] = ['rate_limited', 'auth', 'invalid_request', 'provider_error', 'content_filtered', 'malformed_response', 'network', 'timeout', 'unavailable']
    const failing = (kind: AiErrorKind): LLMProvider => ({
      name: 'failing', model: 'offline',
      generate: async () => {
        throw new AiProviderError(kind, 'failing')
      },
    })
    for (const kind of kinds) {
      // A timeout is the attempt's own time limit on Go: keep it short.
      const timeout = kind === 'timeout' ? '300ms' : '10s'
      const sc = stylistCases()[0]
      const oc = outfitCases()[0]
      const ts = { stylist: withoutLatency(await runStylistCase(failing(kind), sc)), outfit: withoutLatency(await runOutfitCase(failing(kind), oc)) }
      const go = await withGo(failing(kind), null, 'offline', async (g) => ({
        stylist: withoutLatency(await runStylistCaseGo(g, failing(kind), sc)),
        outfit: withoutLatency(await runOutfitCaseGo(g, failing(kind), oc)),
      }), timeout)
      expect(go, kind).toEqual(ts)
    }
  })

  it('a stylist case with style preferences: the same record and the same request', async () => {
    const c = {
      ...stylistCases()[0],
      preferences: { preferredStyles: ['classic'], dislikedStyles: ['sporty'], favoriteColors: ['navy'], dislikedColors: ['red'], preferredFit: 'slim' },
    }
    const tsSide = recording(new ScriptedStylist())
    const ts = withoutLatency(await runStylistCase(tsSide.provider, c))
    const goSide = recording(new ScriptedStylist())
    const go = await withGo(goSide.provider, null, goSide.provider.model, async (g) => withoutLatency(await runStylistCaseGo(g, goSide.provider, c)))
    expect(go).toEqual(ts)
    expect(goSide.asked).toEqual(tsSide.asked)
    expect(JSON.stringify(tsSide.asked)).toContain('sporty')
  })

  it('a corrected answer: the same record, its tokens summed over both requests, the same correction asked', async () => {
    const steps = (n: number, req: LLMRequest) => {
      const refs = ((req.jsonSchema!.schema as { properties: { referencedItems: { items: { enum?: string[] } } } }).properties.referencedItems.items.enum ?? []).slice(0, 2)
      const used = n === 0 ? ['W99'] : refs
      return JSON.stringify({ answer: `Bugun ${used.map((r) => `[${r}]`).join(' va ')} kiying.`, referencedItems: used, needsMoreInfo: false })
    }
    const scripted = (): LLMProvider => {
      let n = 0
      return { name: 'scripted-correction', model: 'offline', generate: async (req) => ({ text: steps(n++, req), metadata: { provider: 'x', model: 'y', usage: {} } }) }
    }
    const c = stylistCases()[0]
    const tsSide = recording(scripted(), { inputTokens: 100, outputTokens: 20 })
    const ts = withoutLatency(await runStylistCase(tsSide.provider, c))
    const goSide = recording(scripted(), { inputTokens: 100, outputTokens: 20 })
    const go = await withGo(goSide.provider, null, 'offline', async (g) => withoutLatency(await runStylistCaseGo(g, goSide.provider, c)))
    expect(go).toEqual(ts)
    expect(ts).toMatchObject({ requests: 2, inputTokens: 200, outputTokens: 40 })
    expect(goSide.asked).toEqual(tsSide.asked)
  })

  it('a corrected ranking: the same record and the same correction asked', async () => {
    const answer = (n: number, req: LLMRequest) => {
      const refs = (req.jsonSchema!.schema as { properties: { ranking: { items: { enum?: string[] } } } }).properties.ranking.items.enum ?? []
      const ranking = n === 0 ? ['O9', ...refs.slice(1)] : refs
      return JSON.stringify({ selectedCandidate: ranking[0], ranking, explanation: 'Bu obraz qulay va sizga mos.', needsMoreInfo: false })
    }
    const scripted = (): LLMProvider => {
      let n = 0
      return { name: 'scripted-correction', model: 'offline', generate: async (req) => ({ text: answer(n++, req), metadata: { provider: 'x', model: 'y', usage: {} } }) }
    }
    const c = outfitCases()[0]
    const tsSide = recording(scripted())
    const ts = withoutLatency(await runOutfitCase(tsSide.provider, c))
    const goSide = recording(scripted())
    const go = await withGo(goSide.provider, null, 'offline', async (g) => withoutLatency(await runOutfitCaseGo(g, goSide.provider, c)))
    expect(go).toEqual(ts)
    expect(ts).toMatchObject({ requests: 2, outcome: { kind: 'ranked', firstError: 'unknown_selected' } })
    expect(goSide.asked).toEqual(tsSide.asked)
  })

  it('vision: the synthetic pictures give the TypeScript outcome', async () => {
    // A scripted model that names what each picture is.
    // What it is asked, but the picture (each pipeline prepares its own, ADR 0009).
    const asked: unknown[] = []
    const scripted: VisionProvider = {
      name: 'scripted-vision', model: 'offline',
      async analyzeImage(req: VisionRequest) {
        asked.push({ instruction: req.instruction, jsonSchema: req.jsonSchema, maxOutputTokens: req.maxOutputTokens, openaiDetail: req.options?.openaiDetail, mimeType: req.mimeType })
        return {
          output: {
            subject: 'single_garment', category: 'shirt', subcategory: 'tshirt', colors: ['white'], pattern: 'solid', material: 'cotton',
            sleeveLength: 'short', fit: 'regular', style: 'casual', season: ['summer'], gender: 'unisex', formality: 'casual',
            confidence: { category: 0.9, subcategory: 0.8, color: 0.9, pattern: 0.8, material: 0.6, sleeveLength: 0.8, fit: 0.6, style: 0.7, season: 0.6, gender: 0.6, formality: 0.7 },
          },
          metadata: { provider: 'scripted-vision', model: 'offline', usage: { inputTokens: 300, outputTokens: 50 } },
        }
      },
    }
    const config = { label: 'offline', provider: 'openai' as const, model: 'offline', maxSide: 768, openaiDetail: 'low' as const }
    const items = syntheticVisionItems()
    await withGo(null, scripted, 'offline', async (g) => {
      for (const item of items) {
        const bytes = await renderSynthetic(item)
        const ts = await runOne(scripted, config as never, bytes)
        const go = await runOneGo(g, config as never, bytes)
        expect({ outcome: go.outcome, usage: go.usage, calls: go.calls }, item.id).toEqual({ outcome: ts.outcome, usage: ts.usage, calls: 1 })
        const [tsAsked, goAsked] = asked.splice(0)
        expect(goAsked, item.id).toEqual(tsAsked)
        expect(tsAsked).toMatchObject({ openaiDetail: 'low', mimeType: 'image/jpeg' })
      }
    })
  })
})
