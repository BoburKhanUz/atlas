/**
 * Local latency of everything ATLAS does around a provider call (Phase 4.5):
 * image preparation, the deterministic mock vision and colour analysis, the
 * outfit engine, prompt construction, output validation and the mock
 * provider. No network. Machine-dependent: report the hardware with the numbers.
 *
 *   bun scripts/ai-eval/timings.ts [--n=30]
 *
 * Live provider latency is NOT measured here (see provider-evaluation.md).
 */
import sharp from 'sharp'
import { analyzeSelfie } from '../../src/lib/ai/color-analysis'
import { CONFIDENCE_KEYS, GARMENT_INSTRUCTION, interpretGarmentOutput } from '../../src/lib/ai/garment-analysis'
import { analyzeClothing } from '../../src/lib/ai/mock-vision'
import { generateOutfitResult, generateOutfits } from '../../src/lib/ai/outfit-engine'
import { interpretOutfitOutput, outfitMessages } from '../../src/lib/ai/outfit-intelligence'
import { MockProvider } from '../../src/lib/ai/providers/mock'
import { prepareVisionImage } from '../../src/lib/ai/providers/vision-input'
import { interpretStylistOutput, parseStylistText, STYLIST_SYSTEM_PROMPT } from '../../src/lib/ai/stylist'
import { buildStylistContext, stylistMessages } from '../../src/lib/ai/stylist-context'
import { selfie } from '../../tests/unit/ai/selfie-fixtures'
import { arg, percentile } from './eval-common'
import { outfitCases } from './outfit-cases'
import { fullWardrobe } from './stylist-cases'

async function time(n: number, f: () => unknown | Promise<unknown>): Promise<{ p50: number; p95: number }> {
  await f() // warm-up (JIT, sharp init)
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    await f()
    ms.push(performance.now() - t)
  }
  const r = (v: number | null) => Math.round((v ?? 0) * 100) / 100
  return { p50: r(percentile(ms, 50)), p95: r(percentile(ms, 95)) }
}

export async function localTimings(n: number) {
  const photo = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#2F5DA8' } }).jpeg({ quality: 90 }).toBuffer()
  const face = await selfie({ skin: '#c68863', hair: '#1b1410', eyes: '#3b2416' })
  const medium = outfitCases().find((c) => c.id === 'cold')!
  const large = outfitCases().find((c) => c.id === 'large_wardrobe')!
  const wardrobe = fullWardrobe()
  const candidates = generateOutfits({ wardrobe, topN: 3 })
  const ctx = buildStylistContext({ items: wardrobe, candidates })
  const oc = generateOutfitResult({ wardrobe: medium.wardrobe, weather: medium.weather, occasion: medium.occasion, topN: 3 })
  const garment = { subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'slim', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: { ...Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9])), sleeveLength: 0 } }
  const stylistText = JSON.stringify({ answer: `Bugun [${ctx.refs[0]}] kiying.`, referencedItems: [ctx.refs[0]], needsMoreInfo: false })
  const outfitText = JSON.stringify({ selectedCandidate: 'O1', ranking: ['O1', 'O2', 'O3'], explanation: 'Yaxshi.', needsMoreInfo: false })
  const mock = new MockProvider()
  return {
    n,
    note: 'local, machine-dependent; no provider latency',
    'vision.prepareImage (3000×4000 JPEG → 1024)': await time(n, () => prepareVisionImage(photo, 1024)),
    'vision.mockAnalysis (deterministic)': await time(n, () => analyzeClothing({ buffer: photo, filename: 'jeans.jpg' })),
    'vision.validateOutput': await time(n, () => interpretGarmentOutput(garment)),
    'color.analyzeSelfie (deterministic)': await time(n, () => analyzeSelfie({ buffer: face })),
    'outfit.engine (18 items)': await time(n, () => generateOutfitResult({ wardrobe: medium.wardrobe, weather: medium.weather, occasion: medium.occasion, topN: 3 })),
    'outfit.engine (185 items)': await time(n, () => generateOutfitResult({ wardrobe: large.wardrobe, weather: large.weather, occasion: large.occasion, topN: 5 })),
    'outfit.buildPrompt': await time(n, () => outfitMessages({ candidates: oc.outfits, occasion: medium.occasion, weather: oc.weather, colorProfile: null })),
    'outfit.validateOutput': await time(n, () => interpretOutfitOutput(outfitText, ['O1', 'O2', 'O3'])),
    'stylist.buildContextAndPrompt (16 items)': await time(n, () => stylistMessages({ system: STYLIST_SYSTEM_PROMPT, context: buildStylistContext({ items: wardrobe, candidates }).data, history: [], message: 'Bugun nima kiyay?', occasionText: null })),
    'stylist.validateOutput': await time(n, () => interpretStylistOutput(parseStylistText(stylistText), ctx.refs)),
    'mockProvider.generate': await time(n, () => mock.generate({ messages: [{ role: 'user', content: GARMENT_INSTRUCTION.slice(0, 50) }], timeoutMs: 1000 })),
  }
}

if (require.main === module) {
  localTimings(Number(arg('n') ?? 30)).then((r) => console.log(JSON.stringify(r, null, 2)))
}
