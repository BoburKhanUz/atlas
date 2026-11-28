/**
 * The offline scenarios of the evaluation harness (docs/plan/B7.md, B7.4): every
 * scripted stylist and outfit case, each provider failure, the two corrections,
 * a case with style preferences and the synthetic garment pictures, run through
 * a pipeline with providers that record what they are asked. What comes out
 * (the records without latency, and the requests) is the offline golden file
 * (tests/eval-go/golden/offline.json): written once from the TypeScript
 * pipeline while it existed, and held against the Go pipeline from then on.
 */
import { AiProviderError } from '../../src/lib/ai/providers/errors'
import type { AiErrorKind, LLMProvider, LLMRequest, VisionProvider, VisionRequest } from './protocol'
import { outfitCases, type OutfitCase } from './outfit-cases'
import { ScriptedOutfit } from './outfit-eval'
import type { OutfitRecord } from './outfit-scoring'
import { runRobustness, type RobustnessResult, type Runners } from './robustness'
import { preferencesCase, stylistCases } from './stylist-cases'
import { ScriptedStylist } from './stylist-eval'
import type { StylistRecord } from './stylist-scoring'
import { renderSynthetic, syntheticVisionItems } from './synthetic-vision'

/** How one case is run: on the TypeScript pipeline, or through `lookly eval`. */
export interface OfflinePipeline extends Runners {
  /** A picture analysed with a vision provider (settings as the bake-off's offline section). */
  vision: (p: VisionProvider, bytes: Uint8Array) => Promise<{ outcome: unknown; usage: { inputTokens?: number; outputTokens?: number } }>
  /** The stylist and outfit runners with a short time limit per attempt (the timeout scenario). */
  withShortTimeout: Runners
}

export const VISION_SETTINGS = { label: 'offline', provider: 'openai' as const, model: 'offline', maxSide: 768, openaiDetail: 'low' as const }

/** What a provider was asked: everything but the time limit (a stand-in does not see it). */
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

const withoutLatency = <T extends { latencyMs: number }>(r: T) => ({ ...r, latencyMs: 0 })

export const FAILURE_KINDS: AiErrorKind[] = ['rate_limited', 'auth', 'invalid_request', 'provider_error', 'content_filtered', 'malformed_response', 'network', 'timeout', 'unavailable']

function failing(kind: AiErrorKind): LLMProvider {
  return {
    name: 'failing', model: 'offline',
    generate: async () => {
      throw new AiProviderError(kind, 'failing')
    },
  }
}

/** A stylist answer naming an unknown item first, then two of the context's. */
function correctingStylist(): LLMProvider {
  let n = 0
  return {
    name: 'scripted-correction', model: 'offline',
    generate: async (req) => {
      const refs = ((req.jsonSchema!.schema as { properties: { referencedItems: { items: { enum?: string[] } } } }).properties.referencedItems.items.enum ?? []).slice(0, 2)
      const used = n++ === 0 ? ['W99'] : refs
      return { text: JSON.stringify({ answer: `Bugun ${used.map((r) => `[${r}]`).join(' va ')} kiying.`, referencedItems: used, needsMoreInfo: false }), metadata: { provider: 'x', model: 'y', usage: {} } }
    },
  }
}

/** A ranking that selects an unknown candidate first, then the given order. */
function correctingRanking(): LLMProvider {
  let n = 0
  return {
    name: 'scripted-correction', model: 'offline',
    generate: async (req) => {
      const refs = (req.jsonSchema!.schema as { properties: { ranking: { items: { enum?: string[] } } } }).properties.ranking.items.enum ?? []
      const ranking = n++ === 0 ? ['O9', ...refs.slice(1)] : refs
      return { text: JSON.stringify({ selectedCandidate: ranking[0], ranking, explanation: 'Bu obraz qulay va sizga mos.', needsMoreInfo: false }), metadata: { provider: 'x', model: 'y', usage: {} } }
    },
  }
}

/** A vision model that names every picture a white T-shirt, recording what it is asked but the picture. */
function scriptedVision() {
  const asked: unknown[] = []
  const provider: VisionProvider = {
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
  return { provider, asked }
}

type Asked<R> = { record: R; asked: unknown[] }

export interface OfflineGolden {
  stylist: Array<Asked<StylistRecord>>
  outfit: Array<Asked<OutfitRecord>>
  failures: Array<{ kind: AiErrorKind; stylist: StylistRecord; outfit: OutfitRecord }>
  corrections: { stylist: Asked<StylistRecord>; outfit: Asked<OutfitRecord> }
  preferences: Asked<StylistRecord>
  vision: Array<{ item: string; outcome: unknown; usage: unknown; asked: unknown[] }>
  robustness: RobustnessResult[]
}

/** Every offline scenario on one pipeline, in a fixed order. */
export async function collectOffline(run: OfflinePipeline): Promise<OfflineGolden> {
  const stylist: OfflineGolden['stylist'] = []
  for (const c of stylistCases()) {
    const side = recording(new ScriptedStylist())
    stylist.push({ record: withoutLatency(await run.stylist(side.provider, c)), asked: side.asked })
  }
  const outfit: OfflineGolden['outfit'] = []
  for (const c of outfitCases()) {
    const side = recording(new ScriptedOutfit())
    outfit.push({ record: withoutLatency(await run.outfit(side.provider, c)), asked: side.asked })
  }
  const failures: OfflineGolden['failures'] = []
  for (const kind of FAILURE_KINDS) {
    const runners = kind === 'timeout' ? run.withShortTimeout : run
    failures.push({
      kind,
      stylist: withoutLatency(await runners.stylist(failing(kind), stylistCases()[0])),
      outfit: withoutLatency(await runners.outfit(failing(kind), outfitCases()[0])),
    })
  }
  const sCorr = recording(correctingStylist(), { inputTokens: 100, outputTokens: 20 })
  const oCorr = recording(correctingRanking())
  const corrections = {
    stylist: { record: withoutLatency(await run.stylist(sCorr.provider, stylistCases()[0])), asked: sCorr.asked },
    outfit: { record: withoutLatency(await run.outfit(oCorr.provider, outfitCases()[0] as OutfitCase)), asked: oCorr.asked },
  }
  const prefs = recording(new ScriptedStylist())
  const preferences = { record: withoutLatency(await run.stylist(prefs.provider, preferencesCase())), asked: prefs.asked }
  const vision: OfflineGolden['vision'] = []
  for (const item of syntheticVisionItems()) {
    const side = scriptedVision()
    const r = await run.vision(side.provider, await renderSynthetic(item))
    vision.push({ item: item.id, outcome: r.outcome, usage: r.usage, asked: side.asked })
  }
  const robustness = await runRobustness(run)
  return { stylist, outfit, failures, corrections, preferences, vision, robustness }
}
