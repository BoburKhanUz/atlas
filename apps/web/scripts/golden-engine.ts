/**
 * Golden vectors for the Go port of the outfit engine (stage B5, parity
 * strength "exact"): the TypeScript code is run on fixed inputs and its
 * results are stored; the Go engine must give the same, to the bit.
 *
 *   - colors: the colour metadata of every catalog colour, the harmony score
 *     of every pair, the occasion score and the contrast of sample sets;
 *   - numbers: Math.round and the seed hash on values where JavaScript's
 *     arithmetic and number formatting matter;
 *   - cases: generateOutfitResult on hand-made and seeded random wardrobes
 *     and contexts, with the deterministic explanation of every outfit;
 *   - compositions: validateComposition and outfitKey.
 *
 *   cd apps/web && bun scripts/golden-engine.ts ../api/testdata/golden/engine.json
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { CATEGORIES, COLORS, FITS, FORMALITIES, MATERIALS, OCCASIONS, PATTERNS, SEASONS, SLEEVE_LENGTHS, STYLES, SUBCATEGORIES } from '@/lib/ai/catalog'
import { contrastLevel, getColorMeta, scoreColorForOccasion, scoreColorPair, type Occasion } from '@/lib/ai/color-theory'
import {
  generateOutfitResult,
  outfitKey,
  seedHash,
  validateComposition,
  type ColorProfileInput,
  type GenerateInput,
  type OutfitFeedbackHint,
  type UserProfileSummary,
  type WardrobeItemSummary,
  type WeatherSnapshot,
} from '@/lib/ai/outfit-engine'
import { deterministicExplanation } from '@/lib/ai/outfit-intelligence'
import type { Slot } from '@/lib/ai/outfit-config'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-engine.ts <output.json>')

// ─── A fixed random source (mulberry32) ─────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = () => number
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)]
const chance = (r: Rand, p: number) => r() < p
const some = <T>(r: Rand, list: readonly T[], max: number): T[] => {
  const n = Math.floor(r() * (max + 1))
  const copy = [...list]
  const picked: T[] = []
  for (let i = 0; i < n && copy.length; i++) picked.push(copy.splice(Math.floor(r() * copy.length), 1)[0])
  return picked
}

// ─── Colours ────────────────────────────────────────────────────────────────

const colorIds = COLORS.map((c) => c.id)
const colors = {
  meta: [...colorIds, 'no_such_colour', ''].map((id) => ({ id, meta: getColorMeta(id) })),
  // Row i, column j: the pair (colour i, colour j); the last row and column are an unknown colour.
  pairs: [...colorIds, 'no_such_colour'].map((a) => [...colorIds, 'no_such_colour'].map((b) => scoreColorPair(a, b).score)),
  occasion: [] as Array<{ sets: string[][]; occasion: Occasion; score: number }>,
  contrast: [] as Array<{ sets: string[][]; level: string }>,
}
{
  const r = mulberry32(11)
  const occasions = OCCASIONS.map((o) => o.id) as Occasion[]
  const sets: string[][][] = [[], [[]], [['white']], [['white'], ['black']], [['no_such_colour']], [['red', 'no_such_colour'], []]]
  for (let i = 0; i < 60; i++) sets.push(Array.from({ length: 1 + Math.floor(r() * 4) }, () => some(r, colorIds, 3)))
  for (const s of sets) {
    for (const occasion of occasions) colors.occasion.push({ sets: s, occasion, score: scoreColorForOccasion(s, occasion).score })
    colors.contrast.push({ sets: s, level: contrastLevel(s) })
  }
}

// ─── Numbers ────────────────────────────────────────────────────────────────

const numbers = {
  round: [0, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994, 4.35, 80.5, 79.5, 79.49999999999999, 100, 49.5, 1e15 + 0.5, 0.1 + 0.2].map((value) => ({
    value,
    rounded: Math.round(value) + 0, // -0 as 0
  })),
  seeds: [
    0, 1, 2, 3, 7, 42, 99, 100, 12345, 2147483647, 4294967296, 9007199254740991, -1, -42, 0.5, 1.5, 0.1, 0.1 + 0.2, 1e21, 1e-7, 1.5e-7, 123456789012345680000, 1e100,
    -1e-9, 5e-324, 1.7976931348623157e308, 0.000001, 0.0000001, 100000000000000000000, 1234.5678, -0,
  ].map((seed) => ({ seed, text: String(seed), hash: seedHash(seed) })),
}

// ─── Wardrobes ──────────────────────────────────────────────────────────────

const cats = CATEGORIES.map((c) => c.id)
const subsOf = (category: string) => (SUBCATEGORIES[category] ?? []).map((s) => s.id)
const allSubs = cats.flatMap(subsOf)
const idsOf = (list: readonly { id: string }[]) => list.map((e) => e.id)

let serial = 0
function randomItem(r: Rand, category = pick(r, cats)): WardrobeItemSummary {
  const nullable = <T>(v: T, p = 0.2): T | null => (chance(r, p) ? null : v)
  const subs = subsOf(category)
  return {
    // Ids as the database makes them (cuid-like), in no order.
    id: `c${Math.floor(r() * 36 ** 6).toString(36).padStart(6, '0')}${(serial++).toString(36).padStart(3, '0')}`,
    category,
    subcategory: chance(r, 0.05) ? pick(r, allSubs) : subs.length ? nullable(pick(r, subs), 0.15) : null,
    colors: chance(r, 0.04) ? [] : chance(r, 0.03) ? ['no_such_colour'] : [pick(r, colorIds), ...some(r, colorIds, 2)],
    pattern: nullable(pick(r, idsOf(PATTERNS))),
    material: nullable(pick(r, idsOf(MATERIALS)), 0.3),
    sleeveLength: nullable(pick(r, idsOf(SLEEVE_LENGTHS)), 0.4),
    fit: nullable(pick(r, idsOf(FITS)), 0.3),
    style: nullable(pick(r, idsOf(STYLES)), 0.25),
    season: some(r, idsOf(SEASONS), 3),
    gender: nullable(pick(r, ['male', 'female', 'unisex']), 0.3),
    formality: chance(r, 0.03) ? 'no_such_formality' : nullable(pick(r, idsOf(FORMALITIES)), 0.45),
  }
}

/** A wardrobe of about n items, weighted towards the pieces an outfit needs. */
function randomWardrobe(r: Rand, n: number): WardrobeItemSummary[] {
  const weighted = ['shirt', 'shirt', 'shirt', 'pants', 'pants', 'shoes', 'shoes', 'dress', 'outerwear', 'bag', 'accessory']
  const items = Array.from({ length: n }, () => randomItem(r, chance(r, 0.04) ? 'no_such_category' : pick(r, weighted)))
  // In no particular order: the engine must not depend on it.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

function randomWeather(r: Rand): Partial<WeatherSnapshot> | undefined {
  const kind = r()
  if (kind < 0.15) return undefined
  const full: WeatherSnapshot = {
    temperature: Math.round((r() * 55 - 15) * 10) / 10,
    feelsLike: Math.round((r() * 55 - 18) * 10) / 10,
    condition: pick(r, ['clear', 'partly_cloudy', 'cloudy', 'rain', 'thunderstorm', 'snow', 'fog', 'no_such_condition']),
    precipitationProbability: Math.round(r() * 100),
    humidity: Math.round(r() * 100),
    windSpeed: Math.round(r() * 70),
    uvIndex: Math.round(r() * 110) / 10,
  }
  if (kind < 0.6) return full
  // Only some of it is known.
  const partial: Partial<WeatherSnapshot> = {}
  for (const key of Object.keys(full) as Array<keyof WeatherSnapshot>) if (chance(r, 0.4)) (partial as Record<string, unknown>)[key] = full[key]
  return partial
}

function randomProfile(r: Rand): UserProfileSummary | undefined {
  const kind = r()
  if (kind < 0.25) return undefined
  if (kind < 0.35) return { gender: null, preferredStyles: [], dislikedStyles: [], favoriteColors: [], dislikedColors: [], preferredFit: null }
  return {
    gender: pick(r, ['male', 'female', null]),
    preferredStyles: some(r, idsOf(STYLES), 3),
    dislikedStyles: some(r, idsOf(STYLES), 2),
    favoriteColors: some(r, colorIds, 4),
    dislikedColors: some(r, colorIds, 3),
    preferredFit: chance(r, 0.5) ? pick(r, idsOf(FITS)) : null,
  }
}

function randomColorProfile(r: Rand): ColorProfileInput | null | undefined {
  const kind = r()
  if (kind < 0.3) return undefined
  if (kind < 0.4) return null
  const season = chance(r, 0.15) ? null : pick(r, ['spring', 'summer', 'autumn', 'winter'])
  const legacy = chance(r, 0.2)
  return {
    season,
    secondarySeason: chance(r, 0.5) ? pick(r, ['spring', 'summer', 'autumn', 'winter', 'no_such_season']) : null,
    undertone: chance(r, 0.15) ? null : pick(r, ['warm', 'neutral_warm', 'neutral', 'neutral_cool', 'cool']),
    confidence: legacy ? null : Math.round(r() * 80) / 100,
    undertoneConfidence: legacy || chance(r, 0.2) ? null : Math.round(r() * 80) / 100,
    secondaryConfidence: chance(r, 0.4) ? null : Math.round(r() * 60) / 100,
    recommendedColors: some(r, colorIds, 8),
    neutralColors: some(r, colorIds, 4),
    cautionColors: some(r, colorIds, 4),
  }
}

type Case = { name: string; input: GenerateInput }
const cases: Case[] = []

// Hand-made cases: the edges the rules name.
const item = (id: string, category: string, rest: Partial<WardrobeItemSummary> = {}): WardrobeItemSummary => ({
  id,
  category,
  subcategory: null,
  colors: [],
  pattern: null,
  material: null,
  sleeveLength: null,
  fit: null,
  style: null,
  season: [],
  gender: null,
  formality: null,
  ...rest,
})
const basics = [
  item('a_shirt', 'shirt', { subcategory: 'oxford_shirt', colors: ['white'], style: 'classic', sleeveLength: 'long' }),
  item('b_tee', 'shirt', { subcategory: 'tshirt', colors: ['navy', 'white'], style: 'casual', sleeveLength: 'short' }),
  item('c_jeans', 'pants', { subcategory: 'jeans', colors: ['blue'], style: 'casual' }),
  item('d_trousers', 'pants', { subcategory: 'trousers', colors: ['black'], style: 'formal', formality: 'formal' }),
  item('e_shorts', 'pants', { subcategory: 'shorts', colors: ['khaki'], style: 'casual' }),
  item('f_sneakers', 'shoes', { subcategory: 'sneakers', colors: ['white'], style: 'casual' }),
  item('g_boots', 'shoes', { subcategory: 'boots', colors: ['brown'] }),
  item('h_sandals', 'shoes', { subcategory: 'sandals', colors: ['tan'] }),
  item('i_coat', 'outerwear', { subcategory: 'coat', colors: ['gray'], material: 'wool' }),
  item('j_blazer', 'outerwear', { subcategory: 'blazer', colors: ['navy'], style: 'formal' }),
  item('k_dress', 'dress', { subcategory: 'evening_dress', colors: ['red'], style: 'formal', sleeveLength: 'sleeveless' }),
  item('l_scarf', 'accessory', { subcategory: 'scarf', colors: ['burgundy'] }),
  item('m_watch', 'accessory', { subcategory: 'watch', colors: ['black'] }),
  item('n_tote', 'bag', { subcategory: 'tote', colors: ['brown'] }),
  item('o_backpack', 'bag', { subcategory: 'backpack', colors: ['black'] }),
  item('p_sunglasses', 'accessory', { subcategory: 'sunglasses', colors: ['black'] }),
  item('q_hat', 'accessory', { subcategory: 'hat', colors: ['beige'] }),
]
const weatherAt = (feelsLike: number, rest: Partial<WeatherSnapshot> = {}): Partial<WeatherSnapshot> => ({ feelsLike, ...rest })

cases.push({ name: 'an empty wardrobe', input: { wardrobe: [] } })
cases.push({ name: 'an empty wardrobe with weather', input: { wardrobe: [], weather: weatherAt(20, { condition: 'clear' }) } })
cases.push({ name: 'no footwear', input: { wardrobe: basics.filter((i) => i.category !== 'shoes') } })
cases.push({ name: 'no main pieces', input: { wardrobe: basics.filter((i) => ['shoes', 'bag', 'accessory', 'outerwear'].includes(i.category)) } })
cases.push({ name: 'tops without bottoms', input: { wardrobe: basics.filter((i) => ['shirt', 'shoes'].includes(i.category)) } })
cases.push({ name: 'only sandals in the cold', input: { wardrobe: basics.filter((i) => i.id !== 'f_sneakers' && i.id !== 'g_boots'), weather: weatherAt(-5) } })
cases.push({ name: 'only shorts in the cold', input: { wardrobe: [basics[0], basics[4], basics[5]], weather: weatherAt(1) } })
cases.push({ name: 'unknown categories only', input: { wardrobe: [item('x1', 'no_such_category'), item('x2', '')] } })
cases.push({ name: 'the basics, nothing known', input: { wardrobe: basics } })
cases.push({ name: 'the basics, an id twice (the last one counts)', input: { wardrobe: [...basics, item('a_shirt', 'shirt', { subcategory: 'polo', colors: ['green'] })] } })
// Each temperature band at and around its lower bound.
for (const t of [-20, 2.9, 3, 11.9, 12, 18.9, 19, 26.9, 27, 40]) cases.push({ name: `the basics at ${t} degrees`, input: { wardrobe: basics, weather: weatherAt(t) } })
// Precipitation, wind and UV at their thresholds.
for (const pct of [29, 30, 59, 60]) cases.push({ name: `the basics, rain ${pct}%`, input: { wardrobe: basics, weather: weatherAt(15, { precipitationProbability: pct }) } })
for (const wind of [29, 30, 49, 50]) cases.push({ name: `the basics, wind ${wind}`, input: { wardrobe: basics, weather: weatherAt(15, { windSpeed: wind }) } })
for (const uv of [5.9, 6]) cases.push({ name: `the basics, UV ${uv}`, input: { wardrobe: basics, weather: weatherAt(30, { uvIndex: uv, condition: 'clear' }) } })
for (const condition of ['rain', 'thunderstorm', 'snow', 'fog', 'clear']) {
  cases.push({ name: `the basics, ${condition}`, input: { wardrobe: basics, weather: { temperature: 8, condition } } })
  cases.push({ name: `the basics, ${condition} only`, input: { wardrobe: basics, weather: { condition } } })
}
cases.push({ name: 'weather with nothing usable', input: { wardrobe: basics, weather: { humidity: 50, uvIndex: 3 } } })
cases.push({ name: 'weather with values that are no numbers', input: { wardrobe: basics, weather: { feelsLike: Number.NaN, temperature: 21, windSpeed: Number.POSITIVE_INFINITY, condition: '' } } })
for (const occasion of OCCASIONS.map((o) => o.id) as Occasion[]) {
  cases.push({ name: `the basics for ${occasion}`, input: { wardrobe: basics, occasion } })
  cases.push({ name: `the basics for ${occasion} in the cold rain`, input: { wardrobe: basics, occasion, weather: weatherAt(4, { condition: 'rain', windSpeed: 35 }) } })
  cases.push({ name: `the basics for ${occasion} in the heat`, input: { wardrobe: basics, occasion, weather: weatherAt(33, { condition: 'clear', uvIndex: 9 }) } })
}
for (const topN of [1, 2, 4, 5, 0, 9, 2.9, -3]) cases.push({ name: `the basics, topN ${topN}`, input: { wardrobe: basics, topN } })
for (const seed of [0, 1, 2, 3, 42, -1, 0.5, 1e21, 123456789]) {
  cases.push({ name: `the basics, seed ${seed}`, input: { wardrobe: basics, seed } })
  cases.push({ name: `the basics, seed ${seed}, one outfit`, input: { wardrobe: basics, seed, topN: 1 } })
}
cases.push({
  name: 'the basics with preferences',
  input: {
    wardrobe: basics,
    profile: { gender: 'female', preferredStyles: ['classic'], dislikedStyles: ['casual'], favoriteColors: ['white', 'navy'], dislikedColors: ['khaki'], preferredFit: 'regular' },
  },
})
for (const [name, colorProfile] of Object.entries<ColorProfileInput>({
  'a full colour profile': { season: 'winter', secondarySeason: 'summer', undertone: 'cool', confidence: 0.7, undertoneConfidence: 0.6, secondaryConfidence: 0.3, recommendedColors: ['white', 'navy', 'black'], neutralColors: ['gray'], cautionColors: ['khaki', 'tan'] },
  'a profile below the confidence that counts': { season: 'winter', secondarySeason: null, undertone: 'cool', confidence: 0.24, undertoneConfidence: 0.6, secondaryConfidence: null, recommendedColors: ['white'], neutralColors: [], cautionColors: ['khaki'] },
  'a profile at the confidence that counts': { season: 'winter', secondarySeason: null, undertone: 'cool', confidence: 0.25, undertoneConfidence: 0.39, secondaryConfidence: null, recommendedColors: ['white'], neutralColors: [], cautionColors: ['khaki'] },
  'a profile from before confidences': { season: 'autumn', secondarySeason: 'spring', undertone: 'neutral_warm', confidence: null, undertoneConfidence: null, secondaryConfidence: null, recommendedColors: ['brown', 'khaki'], neutralColors: ['beige'], cautionColors: ['white'] },
  'an undertone without a season': { season: null, secondarySeason: null, undertone: 'warm', confidence: 0.5, undertoneConfidence: 0.5, secondaryConfidence: null, recommendedColors: ['white'], neutralColors: [], cautionColors: [] },
  'neither season nor undertone': { season: null, secondarySeason: 'winter', undertone: 'neutral', confidence: 0.6, undertoneConfidence: 0.6, secondaryConfidence: 0.5, recommendedColors: ['white'], neutralColors: [], cautionColors: [] },
})) {
  cases.push({ name: `the basics with ${name}`, input: { wardrobe: basics, colorProfile } })
}

// A stored formality that is empty is "known and empty" (?? stops at it): the
// subcategory's and the style's formality are not used for that item.
cases.push({
  name: 'an empty stored formality',
  input: {
    wardrobe: [...basics, item('r_blazer', 'outerwear', { subcategory: 'blazer', colors: ['black'], formality: '' }), item('s_tee', 'shirt', { subcategory: 'tshirt', colors: ['white'], formality: '', style: 'casual' })],
    occasion: 'work',
  },
})

// Seeded random wardrobes and contexts.
{
  const r = mulberry32(20261127)
  // The last one is larger than every slot's limit of finalists.
  const sizes = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26, 30, 36, 45, 60]
  const count = 69
  for (let i = 0; i < count; i++) {
    const wardrobe = randomWardrobe(r, i === count - 1 ? 150 : sizes[i % sizes.length])
    const occasion = chance(r, 0.35) ? undefined : (pick(r, OCCASIONS.map((o) => o.id)) as Occasion)
    const input: GenerateInput = { wardrobe, weather: randomWeather(r), occasion, profile: randomProfile(r), colorProfile: randomColorProfile(r) }
    if (chance(r, 0.4)) input.topN = 1 + Math.floor(r() * 5)
    if (chance(r, 0.45)) input.seed = chance(r, 0.8) ? Math.floor(r() * 1000) : (r() - 0.5) * 1e6
    if (chance(r, 0.5) && wardrobe.length > 0) {
      // Feedback as the route builds it: liked and rejected items, and the
      // main compositions of outfits this very wardrobe gives.
      const ids = wardrobe.map((w) => w.id)
      const keys = generateOutfitResult({ ...input, topN: 5, seed: undefined }).outfits.map((o) => o.mainKey)
      const feedback: OutfitFeedbackHint = {
        rejectedItemIds: some(r, ids, 4).sort(),
        likedItemIds: some(r, ids, 4).sort(),
        rejectedOutfitKeys: chance(r, 0.3) ? undefined : some(r, [...keys, 't:nobody|b:nobody|d:-|o:-|f:nobody|a:'], 3).sort(),
      }
      input.feedback = chance(r, 0.15) ? { rejectedItemIds: [], likedItemIds: [], rejectedOutfitKeys: feedback.rejectedOutfitKeys } : feedback
    }
    cases.push({ name: `random ${i + 1} (${wardrobe.length} items)`, input })
  }
}

const results = cases.map(({ name, input }) => {
  const result = generateOutfitResult(input)
  return {
    name,
    // NaN and the infinities do not survive JSON: named here, put back by the reader.
    input: JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? { number: String(v) } : v))),
    output: {
      problem: result.problem,
      evaluated: result.evaluated,
      weather: result.weather,
      outfits: result.outfits.map((o) => ({
        tempId: o.tempId,
        key: o.key,
        mainKey: o.mainKey,
        items: o.items.map((i) => ({ id: i.item.id, role: i.role, slot: i.slot })),
        score: o.score,
        rawScore: o.rawScore,
        signals: o.signals,
        factors: o.factors,
        reasons: o.reasons,
        reasonLabels: o.reasonLabels,
        contrastLevel: o.contrastLevel,
        explanation: deterministicExplanation(o, { occasion: input.occasion, weather: result.weather }),
      })),
    },
  }
})

// ─── Compositions ───────────────────────────────────────────────────────────

const compositions = [] as Array<{ items: Array<{ id: string; category: string }>; error: string | null }>
{
  const r = mulberry32(5)
  const fixed: Array<Array<[string, string]>> = [
    [],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes']],
    [['a', 'dress'], ['c', 'shoes']],
    [['a', 'shirt'], ['a', 'pants'], ['c', 'shoes']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'shoes']],
    [['a', 'shirt'], ['b', 'pants']],
    [['a', 'dress'], ['b', 'pants'], ['c', 'shoes']],
    [['a', 'dress'], ['b', 'dress'], ['c', 'shoes']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'outerwear'], ['e', 'outerwear']],
    [['a', 'shirt'], ['c', 'shoes']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'accessory'], ['e', 'accessory'], ['f', 'accessory']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'accessory'], ['e', 'accessory'], ['f', 'bag']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'bag'], ['e', 'bag']],
    [['a', 'shirt'], ['b', 'pants'], ['c', 'shoes'], ['d', 'no_such_category']],
    [['a', 'outerwear'], ['c', 'shoes']],
  ]
  for (const f of fixed) compositions.push({ items: f.map(([id, category]) => ({ id, category })), error: null })
  for (let i = 0; i < 80; i++) {
    const n = 1 + Math.floor(r() * 7)
    compositions.push({ items: Array.from({ length: n }, (_, k) => ({ id: chance(r, 0.08) ? 'same' : `i${k}`, category: chance(r, 0.05) ? 'other' : pick(r, cats) })), error: null })
  }
  for (const c of compositions) c.error = validateComposition(c.items)
}

const keys = [
  [] as Array<[string, Slot]>,
  [['t1', 'top'], ['b1', 'bottom'], ['f1', 'footwear']] as Array<[string, Slot]>,
  [['d1', 'dress'], ['f1', 'footwear'], ['o1', 'outerwear']] as Array<[string, Slot]>,
  [['t1', 'top'], ['b1', 'bottom'], ['f1', 'footwear'], ['z', 'accessory'], ['a', 'accessory'], ['m', 'accessory']] as Array<[string, Slot]>,
  [['t1', 'top'], ['t2', 'top'], ['f1', 'footwear']] as Array<[string, Slot]>,
].map((pieces) => ({ pieces: pieces.map(([id, slot]) => ({ id, slot })), key: outfitKey(pieces.map(([id, slot]) => ({ item: { id }, slot }))) }))

const sourceCommit = execSync('git rev-parse HEAD').toString().trim()
writeFileSync(
  out,
  JSON.stringify({
    generatedBy: 'apps/web/scripts/golden-engine.ts',
    sourceCommit,
    note: 'Generated from the TypeScript outfit engine; never edited by hand. A mismatch in the Go port is investigated, not regenerated away.',
    colors,
    numbers,
    cases: results,
    compositions,
    keys,
  }) + '\n',
)
console.log(`wrote ${out}: ${results.length} cases, ${results.filter((c) => c.output.outfits.length > 0).length} with outfits`)
