/**
 * Phase 4.4 deterministic outfit engine: composition, hard filters, weather,
 * colour profile, occasion, ranking determinism, seed, de-duplication,
 * accessories, edge cases and bounded generation.
 */
import { describe, expect, it } from 'vitest'
import { getColorMeta, scoreColorPair } from '@/lib/ai/color-theory'
import {
  MAX_CANDIDATES,
  SLOT_AREA,
  MAX_ITEM_REPEAT,
  POOL_SIZE,
  SLOT_LIMITS,
  TEMPERATURE_BANDS,
} from '@/lib/ai/outfit-config'
import {
  bandOf,
  colorSignal,
  compareCandidates,
  exposedWithOuterwear,
  generateOutfitResult,
  generateOutfits,
  keyId,
  outfitKey,
  profileContext,
  seedHash,
  selectWithSeed,
  styleSignal,
  validateComposition,
  varietyPool,
  warmthOf,
  weatherContext,
  weatherExcludes,
  type ColorProfileInput,
  type OutfitCandidate,
  type WardrobeItemSummary,
  type WeatherSnapshot,
} from '@/lib/ai/outfit-engine'

let n = 0
function item(category: string, subcategory: string | null, colors: string[], extra: Partial<WardrobeItemSummary> = {}): WardrobeItemSummary {
  n++
  return {
    id: `it_${String(n).padStart(4, '0')}_${subcategory ?? category}`,
    category,
    subcategory,
    colors,
    pattern: 'solid',
    material: null,
    sleeveLength: null,
    fit: 'regular',
    style: 'casual',
    season: [],
    gender: 'unisex',
    formality: null,
    ...extra,
  }
}
const W = (t: number, condition = 'cloudy', pct = 0, wind = 5, uv = 3): WeatherSnapshot => ({ temperature: t, feelsLike: t, condition, precipitationProbability: pct, humidity: 50, windSpeed: wind, uvIndex: uv })
const subs = (o: OutfitCandidate) => o.items.map((i) => i.item.subcategory)
const slots = (o: OutfitCandidate) => o.items.map((i) => i.slot).sort()

const tee = () => item('shirt', 'tshirt', ['white'], { sleeveLength: 'short', season: ['summer'] })
const oxford = () => item('shirt', 'oxford_shirt', ['light_blue'], { sleeveLength: 'long', style: 'smart_casual', formality: 'smart_casual' })
const knit = () => item('shirt', 'knit', ['beige'], { sleeveLength: 'long', material: 'wool', season: ['winter', 'autumn'] })
const jeans = () => item('pants', 'jeans', ['blue'])
const chinos = () => item('pants', 'chinos', ['khaki'], { style: 'smart_casual', formality: 'smart_casual' })
const shorts = () => item('pants', 'shorts', ['navy'], { season: ['summer'] })
const dress = () => item('dress', 'midi_dress', ['burgundy'], { formality: 'smart_casual', style: 'smart_casual' })
const coat = () => item('outerwear', 'coat', ['gray'], { material: 'wool' })
const windbreaker = () => item('outerwear', 'windbreaker', ['olive'])
const blazer = () => item('outerwear', 'blazer', ['navy'], { formality: 'formal', style: 'formal' })
const sneakers = () => item('shoes', 'sneakers', ['white'])
const sandals = () => item('shoes', 'sandals', ['tan'])
const loafers = () => item('shoes', 'loafers', ['brown'], { formality: 'smart_casual', style: 'smart_casual' })
const boots = () => item('shoes', 'boots', ['black'])

function wardrobe() {
  return [tee(), oxford(), knit(), jeans(), chinos(), shorts(), dress(), coat(), windbreaker(), blazer(), sneakers(), sandals(), loafers(), boots()]
}

// ─── Composition ────────────────────────────────────────────────────────────

describe('composition', () => {
  it('standard outfit: top + bottom + footwear, roles mapped (legacy role kept)', () => {
    const [o] = generateOutfits({ wardrobe: [tee(), jeans(), sneakers()] })
    expect(slots(o)).toEqual(['bottom', 'footwear', 'top'])
    expect(o.items.map((i) => i.role).sort()).toEqual(['bottom', 'shoes', 'top'])
  })

  it('dress outfit: dress + footwear (a dress is never a top, never with a bottom)', () => {
    const r = generateOutfits({ wardrobe: [dress(), sneakers()] })
    expect(r).toHaveLength(1)
    expect(slots(r[0])).toEqual(['dress', 'footwear'])
    expect(r[0].items.find((i) => i.slot === 'dress')!.role).toBe('top') // legacy role for old clients
  })

  it('a dress-only wardrobe gets outfits (the old engine required a bottom)', () => {
    expect(generateOutfits({ wardrobe: [dress(), loafers()] })).toHaveLength(1)
  })

  it('layered outfit: outerwear is its own layer over a top, never a top itself', () => {
    const r = generateOutfits({ wardrobe: [coat(), jeans(), boots()], weather: W(1) })
    expect(r).toEqual([]) // coat + jeans with no base top is not an outfit
    const layered = generateOutfits({ wardrobe: [knit(), coat(), jeans(), boots()], weather: W(1) })[0]
    expect(slots(layered)).toEqual(['bottom', 'footwear', 'outerwear', 'top'])
  })

  it('footwear is required: no shoes → no outfit, with a reason', () => {
    const r = generateOutfitResult({ wardrobe: [tee(), jeans(), dress()] })
    expect(r.outfits).toEqual([])
    expect(r.problem).toBe('no_footwear')
  })

  it('accessories are optional: attached only when they suit, never required', () => {
    const base = [knit(), jeans(), boots(), coat()]
    const cold = generateOutfits({ wardrobe: [...base, item('accessory', 'scarf', ['gray'])], weather: W(0) })[0]
    expect(subs(cold)).toContain('scarf')
    const hot = generateOutfits({ wardrobe: [tee(), shorts(), sneakers(), item('accessory', 'scarf', ['gray'])], weather: W(32) })[0]
    expect(subs(hot)).not.toContain('scarf')
    expect(generateOutfits({ wardrobe: [tee(), jeans(), sneakers()] })[0].items).toHaveLength(3)
  })

  it('accessories never change which outfits are chosen (ranked separately)', () => {
    const base = [tee(), oxford(), jeans(), chinos(), sneakers(), loafers()]
    const a = generateOutfits({ wardrobe: base, occasion: 'work' }).map((o) => o.mainKey)
    const b = generateOutfits({ wardrobe: [...base, item('accessory', 'watch', ['black']), item('bag', 'tote', ['black'])], occasion: 'work' }).map((o) => o.mainKey)
    expect(b).toEqual(a)
  })

  it('outer layer over shorts or sandals is never generated', () => {
    for (const o of generateOutfits({ wardrobe: wardrobe(), weather: W(15), topN: 5 })) {
      const outer = o.items.some((i) => i.slot === 'outerwear')
      if (outer) expect(subs(o).some((s) => s === 'shorts' || s === 'sandals')).toBe(false)
    }
    expect(exposedWithOuterwear(shorts(), sneakers())).toBe(true)
    expect(exposedWithOuterwear(jeans(), sandals())).toBe(true)
    expect(exposedWithOuterwear(jeans(), boots())).toBe(false)
  })

  it('validateComposition (also used when saving)', () => {
    const c = (...cats: string[]) => cats.map((category, i) => ({ id: `x${i}`, category }))
    expect(validateComposition(c('shirt', 'pants', 'shoes'))).toBeNull()
    expect(validateComposition(c('shirt', 'pants', 'outerwear', 'shoes', 'accessory', 'bag'))).toBeNull()
    expect(validateComposition(c('dress', 'shoes'))).toBeNull()
    expect(validateComposition(c('dress', 'outerwear', 'shoes'))).toBeNull()
    expect(validateComposition(c('shirt', 'pants'))).toBe('missing_footwear')
    expect(validateComposition(c('shirt', 'pants', 'shoes', 'shoes'))).toBe('multiple_footwear')
    expect(validateComposition(c('dress', 'pants', 'shoes'))).toBe('dress_with_top_or_bottom')
    expect(validateComposition(c('dress', 'shirt', 'shoes'))).toBe('dress_with_top_or_bottom')
    expect(validateComposition(c('shirt', 'shirt', 'pants', 'shoes'))).toBe('multiple_primary')
    expect(validateComposition(c('shirt', 'pants', 'outerwear', 'outerwear', 'shoes'))).toBe('multiple_primary')
    expect(validateComposition(c('outerwear', 'pants', 'shoes'))).toBe('missing_main')
    expect(validateComposition(c('shirt', 'shoes'))).toBe('missing_main')
    expect(validateComposition(c('shirt', 'pants', 'shoes', 'bag', 'bag'))).toBe('too_many_accessories')
    expect(validateComposition(c('shirt', 'pants', 'shoes', 'hat'))).toBe('unknown_category')
    expect(validateComposition([{ id: 'a', category: 'shirt' }, { id: 'a', category: 'shirt' }, { id: 'b', category: 'pants' }, { id: 'c', category: 'shoes' }])).toBe('duplicate_item')
  })
})

// ─── Weather ────────────────────────────────────────────────────────────────

describe('weather', () => {
  it('temperature bands come from one table', () => {
    expect(TEMPERATURE_BANDS.map((b) => b.band)).toEqual(['very_cold', 'cold', 'mild', 'warm', 'hot'])
    expect([-10, 5, 15, 22, 30].map(bandOf)).toEqual(['very_cold', 'cold', 'mild', 'warm', 'hot'])
  })

  it('missing fields stay unknown; no weather → null', () => {
    expect(weatherContext(undefined)).toBeNull()
    expect(weatherContext({})).toBeNull()
    const onlyTemp = weatherContext({ temperature: 15 })!
    expect(onlyTemp).toMatchObject({ band: 'mild', wet: null, wind: null, snow: null })
    expect(onlyTemp.completeness).toBeCloseTo(1 / 3)
    const onlyRain = weatherContext({ condition: 'rain' })!
    expect(onlyRain).toMatchObject({ band: null, wet: 'likely' })
    expect(weatherContext({ precipitationProbability: 40 })!.wet).toBe('possible')
  })

  it('cold: no shorts or sandals; a layer when the wardrobe has one; short sleeves only under a layer', () => {
    const r = generateOutfits({ wardrobe: wardrobe(), weather: W(1), topN: 5 })
    expect(r.length).toBeGreaterThan(0)
    for (const o of r) {
      expect(subs(o)).not.toContain('shorts')
      expect(subs(o)).not.toContain('sandals')
      if (o.items.some((i) => i.item.subcategory === 'tshirt' || i.slot === 'dress')) expect(o.items.some((i) => i.slot === 'outerwear')).toBe(true)
    }
    expect(r[0].reasons).toContain('warm_layers')
  })

  it('hard exclusions, item by item', () => {
    const ex = (it: WardrobeItemSummary, slot: Parameters<typeof weatherExcludes>[1], w: Partial<WeatherSnapshot>) => weatherExcludes(it, slot, weatherContext(w))
    expect(ex(sandals(), 'footwear', W(5))).toBe(true)
    expect(ex(shorts(), 'bottom', W(5))).toBe(true)
    expect(ex(sandals(), 'footwear', W(15))).toBe(false)
    expect(ex(item('outerwear', 'jacket', []), 'outerwear', W(30))).toBe(true) // warmth 2
    expect(ex(item('outerwear', 'windbreaker', []), 'outerwear', W(30))).toBe(false) // warmth 1
    expect(ex(item('outerwear', 'jacket', []), 'outerwear', W(24))).toBe(false)
    expect(ex(sandals(), 'footwear', W(20, 'rain', 90))).toBe(true)
    expect(ex(sandals(), 'footwear', W(20, 'cloudy', 40))).toBe(false) // rain only possible
    expect(ex(item('accessory', 'sunglasses', []), 'accessory', W(20, 'rain', 90))).toBe(true)
    expect(ex(item('accessory', 'hat', []), 'accessory', W(20, 'clear', 0, 35))).toBe(false) // windy, not strong
    expect(weatherExcludes(sandals(), 'footwear', null)).toBe(false)
  })

  it('very cold: every outfit has an outer layer when one exists', () => {
    for (const o of generateOutfits({ wardrobe: wardrobe(), weather: W(-8), topN: 5 })) expect(o.items.some((i) => i.slot === 'outerwear')).toBe(true)
  })

  it('cold with only shorts → nothing suitable (no fabricated outfit)', () => {
    const r = generateOutfitResult({ wardrobe: [tee(), shorts(), sneakers()], weather: W(0) })
    expect(r.outfits).toEqual([])
    expect(r.problem).toBe('nothing_suitable')
  })

  it('hot: no warm outerwear; light pieces rank first', () => {
    const r = generateOutfits({ wardrobe: wardrobe(), weather: W(33, 'clear', 0, 5, 9), topN: 5 })
    for (const o of r) expect(subs(o)).not.toContain('coat')
    expect(subs(r[0])).toContain('tshirt')
  })

  it('rain: no sandals; protective layer and wet-friendly shoes rank first', () => {
    const r = generateOutfits({ wardrobe: wardrobe(), weather: W(14, 'rain', 90, 15), topN: 5 })
    for (const o of r) expect(subs(o)).not.toContain('sandals')
    expect(r[0].reasons).toContain('rain_ready')
    expect(r[0].items.some((i) => ['coat', 'windbreaker', 'jacket'].includes(i.item.subcategory ?? ''))).toBe(true)
  })

  it('rain: wet-friendly shoes beat loafers when nothing else differs', () => {
    const top = oxford(), pants = jeans(), sneak = item('shoes', 'sneakers', ['white'], { style: 'smart_casual', formality: 'smart_casual' }), loaf = loafers()
    const r = generateOutfits({ wardrobe: [top, pants, sneak, loaf], weather: W(15, 'rain', 90), topN: 2 })
    expect(subs(r[0])).toContain('sneakers')
    expect(r[0].signals.weather!).toBeGreaterThan(r[1].signals.weather!)
  })

  it('rain with no outerwear at all still gives an outfit (lower weather score), never sandals', () => {
    const dry = generateOutfits({ wardrobe: [oxford(), jeans(), sneakers(), sandals()], weather: W(15, 'cloudy', 0) })[0]
    const wet = generateOutfits({ wardrobe: [oxford(), jeans(), sneakers(), sandals()], weather: W(15, 'rain', 90) })[0]
    expect(subs(wet)).toContain('sneakers')
    expect(wet.signals.weather!).toBeLessThan(dry.signals.weather!)
  })

  it('snow: boots rank first and the reason says so (not "rain")', () => {
    const r = generateOutfits({ wardrobe: wardrobe(), weather: W(-4, 'snow', 80) })
    expect(subs(r[0])).toContain('boots')
    expect(r[0].reasons).toContain('snow_ready')
    expect(r[0].reasons).not.toContain('rain_ready')
  })

  it('strong wind: protective outerwear ranks first; hats are excluded', () => {
    const w = [...wardrobe(), item('accessory', 'hat', ['black'])]
    const r = generateOutfits({ wardrobe: w, weather: W(16, 'clear', 0, 60), topN: 3 })
    expect(r[0].reasons).toContain('wind_ready')
    for (const o of r) expect(subs(o)).not.toContain('hat')
    expect(weatherExcludes(item('accessory', 'hat', []), 'accessory', weatherContext(W(16, 'clear', 0, 60)))).toBe(true)
  })

  it('incomplete weather counts less: a poor weather fit pulls the score down less', () => {
    const w = [knit(), jeans(), boots()]
    const full = generateOutfits({ wardrobe: w, weather: W(33) })[0]
    const partial = generateOutfits({ wardrobe: w, weather: { temperature: 33, feelsLike: 33 } })[0]
    expect(partial.signals.weather).toBe(full.signals.weather) // same weather fit…
    expect(partial.rawScore).toBeGreaterThan(full.rawScore) // …with a third of the influence
  })

  it('incomplete weather reduces the weather signal’s influence but never rejects for a missing field', () => {
    const full = generateOutfits({ wardrobe: wardrobe(), weather: W(15) })
    const partial = generateOutfits({ wardrobe: wardrobe(), weather: { temperature: 15 } })
    expect(partial.length).toBe(full.length)
    expect(partial[0].signals.weather).toBeDefined()
  })

  it('warmth: subcategory, material and sleeves', () => {
    expect(warmthOf(coat())).toBe(3)
    expect(warmthOf(tee())).toBe(0)
    expect(warmthOf(knit())).toBe(3)
    expect(warmthOf(item('shirt', 'oxford_shirt', [], { material: 'linen', sleeveLength: 'short' }))).toBe(0)
  })
})

// ─── Occasion, style, colour ────────────────────────────────────────────────

describe('occasion, style and colour', () => {
  it('work: casual pieces lose to smart/formal ones when those exist', () => {
    const [o] = generateOutfits({ wardrobe: [tee(), oxford(), jeans(), chinos(), sneakers(), loafers()], occasion: 'work' })
    expect(subs(o).sort()).toEqual(['chinos', 'loafers', 'oxford_shirt'])
    expect(o.reasons).toContain('occasion')
  })

  it('work with only casual clothes still gives an outfit (nothing better exists)', () => {
    expect(generateOutfits({ wardrobe: [tee(), jeans(), sneakers()], occasion: 'work' })).toHaveLength(1)
  })

  it('casual does not require formal clothes', () => {
    const [o] = generateOutfits({ wardrobe: [tee(), oxford(), jeans(), chinos(), sneakers(), loafers()], occasion: 'casual' })
    expect(o.signals.occasion!).toBeGreaterThanOrEqual(80)
  })

  it('style: same style > same family > mixed; under two known styles → unavailable', () => {
    const p = (...styles: string[]) => styles.map((style) => ({ item: item('shirt', null, [], { style }), slot: 'top' as const }))
    expect(styleSignal(p('casual', 'casual'))).toBe(95)
    expect(styleSignal(p('casual', 'sporty'))).toBe(82)
    expect(styleSignal(p('smart_casual', 'casual'))).toBe(82) // an oxford shirt with jeans is a classic pairing
    expect(styleSignal(p('formal', 'sporty'))!).toBeLessThan(60)
    expect(styleSignal(p('casual'))).toBeNull()
  })

  it('colour: neutral base and analogous colours beat clashing accents; dominant colours decide', () => {
    const pieces = (...colors: string[][]) => colors.map((c, i) => ({ item: item(['shirt', 'pants', 'shoes'][i], null, c), slot: (['top', 'bottom', 'footwear'] as const)[i] }))
    const neutral = colorSignal(pieces(['navy'], ['white'], ['black']))!
    const clash = colorSignal(pieces(['red'], ['green'], ['purple']))!
    expect(neutral).toBeGreaterThan(clash)
    // A small accent (secondary colour) does not override a harmonious dominant palette.
    const withAccent = colorSignal(pieces(['navy', 'orange'], ['white'], ['black']))!
    expect(withAccent).toBeGreaterThan(clash)
    expect(colorSignal(pieces(['navy']))).toBeNull()
  })

  it('colour formula: area-weighted dominant pairs (80 %) + secondary (20 %), +5 neutral, −12 per accent family beyond two', () => {
    type P = { item: WardrobeItemSummary; slot: 'top' | 'bottom' | 'outerwear' | 'footwear' }
    const P = (slot: P['slot'], colors: string[]): P => ({ item: item('shirt', null, colors), slot })
    const expected = (ps: P[]) => {
      let num = 0, den = 0
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i].item.colors, b = ps[j].item.colors
        const d = scoreColorPair(a[0], b[0]).score
        const sec = [...a.slice(1).map((c) => scoreColorPair(c, b[0]).score), ...b.slice(1).map((c) => scoreColorPair(a[0], c).score)]
        const w = SLOT_AREA[ps[i].slot] * SLOT_AREA[ps[j].slot]
        num += w * (0.8 * d + 0.2 * (sec.length ? sec.reduce((x, y) => x + y, 0) / sec.length : d))
        den += w
      }
      const metas = ps.map((p) => getColorMeta(p.item.colors[0])!)
      const accents = new Set(metas.filter((m) => !m.isNeutral).map((m) => Math.round(m.hue / 30))).size
      return Math.min(100, Math.max(0, num / den + (metas.some((m) => m.isNeutral) ? 5 : 0) - (accents > 2 ? 12 * (accents - 2) : 0)))
    }
    const cases: P[][] = [
      [P('top', ['red']), P('bottom', ['white']), P('footwear', ['black'])], // neutral bonus
      [P('top', ['red']), P('bottom', ['green']), P('outerwear', ['blue']), P('footwear', ['yellow'])], // accent penalty
      [P('top', ['navy', 'orange']), P('bottom', ['beige', 'red']), P('footwear', ['brown'])], // secondary colours
    ]
    for (const ps of cases) expect(colorSignal(ps)!).toBeCloseTo(expected(ps), 6)
    expect(expected(cases[1])).toBeLessThan(expected(cases[0]))
  })
})

// ─── Colour profile ─────────────────────────────────────────────────────────

describe('colour profile', () => {
  const profile = (over: Partial<ColorProfileInput> = {}): ColorProfileInput => ({
    season: 'autumn',
    secondarySeason: 'spring',
    undertone: 'warm',
    confidence: 0.7,
    undertoneConfidence: 0.6,
    secondaryConfidence: 0.2,
    recommendedColors: ['olive', 'rust', 'mustard', 'brown'],
    neutralColors: ['beige', 'tan'],
    cautionColors: ['white', 'light_blue', 'pink', 'gray'],
    ...over,
  })
  const fixed = [item('shirt', 'tshirt', ['olive']), item('shirt', 'tshirt', ['light_blue']), item('pants', 'jeans', ['navy']), item('shoes', 'sneakers', ['black'])]
  const tops = () => fixed.slice(0, 2)
  const rest = () => fixed.slice(2)

  it('a confident profile prefers its recommended colours near the face', () => {
    const [o] = generateOutfits({ wardrobe: [...tops(), ...rest()], colorProfile: profile() })
    expect(o.items.find((i) => i.slot === 'top')!.item.colors[0]).toBe('olive')
    expect(o.reasons).toContain('color_profile')
  })

  it('low confidence, null season with unknown undertone, or no profile → no profile influence', () => {
    expect(profileContext(profile({ confidence: 0.1 }))).toBeNull()
    expect(profileContext(profile({ season: null, undertone: 'unknown' }))).toBeNull()
    expect(profileContext(null)).toBeNull()
    const a = generateOutfits({ wardrobe: [...tops(), ...rest()], colorProfile: profile({ confidence: 0.1 }) })
    const b = generateOutfits({ wardrobe: [...tops(), ...rest()] })
    expect(a.map((o) => o.mainKey)).toEqual(b.map((o) => o.mainKey))
    expect(a[0].signals.profile).toBeUndefined()
  })

  it('influence scales with confidence (the recommended-vs-caution gap widens)', () => {
    const gap = (confidence: number) => {
      const r = generateOutfits({ wardrobe: [...tops(), ...rest()], colorProfile: profile({ confidence }), topN: 2 })
      const score = (c: string) => r.find((o) => o.items.some((i) => i.slot === 'top' && i.item.colors[0] === c))!.rawScore
      return score('olive') - score('light_blue')
    }
    expect(gap(0.8)).toBeGreaterThan(gap(0.5))
    expect(gap(0.5)).toBeGreaterThan(gap(0.3))
  })

  it('unreliable undertone is ignored; a null season still allows a reliable undertone', () => {
    expect(profileContext(profile({ undertoneConfidence: 0.2 }))!.undertone).toBeNull()
    const ctx = profileContext(profile({ season: null, recommendedColors: [], neutralColors: [], cautionColors: [] }))!
    expect(ctx.undertone).toBe('warm')
    expect(ctx.recommended.size).toBe(0)
  })

  it('secondary season palette counts only when its confidence is meaningful', () => {
    expect(profileContext(profile({ secondaryConfidence: 0.25 }))!.secondary.size).toBeGreaterThan(0)
    expect(profileContext(profile({ secondaryConfidence: 0.05 }))!.secondary.size).toBe(0)
  })

  it('legacy profiles (no stored confidence) get a low assumed confidence', () => {
    expect(profileContext(profile({ confidence: null, undertoneConfidence: null }))!.strength).toBe(0.3)
  })
})

// ─── Ranking, seed, de-duplication ──────────────────────────────────────────

describe('ranking determinism', () => {
  it('same input → identical result; input order never matters', () => {
    const w = wardrobe()
    const a = generateOutfits({ wardrobe: w, weather: W(15), occasion: 'casual', topN: 5 })
    const b = generateOutfits({ wardrobe: [...w].reverse(), weather: W(15), occasion: 'casual', topN: 5 })
    expect(b).toEqual(a)
  })

  it('duplicate wardrobe rows (same id) count once', () => {
    const t = tee(), j = jeans(), s = sneakers()
    expect(generateOutfits({ wardrobe: [t, t, j, s, s] })).toHaveLength(1)
  })

  it('ties are broken by the canonical key, never by randomness', () => {
    // Two identical t-shirts: same score, different ids → ordered by key.
    const r = generateOutfits({ wardrobe: [item('shirt', 'tshirt', ['white']), item('shirt', 'tshirt', ['white']), jeans(), sneakers()], topN: 2 })
    expect(r[0].rawScore).toBe(r[1].rawScore)
    expect(r[0].key < r[1].key).toBe(true)
    const sorted = [...r].reverse().sort(compareCandidates)
    expect(sorted.map((o) => o.key)).toEqual(r.map((o) => o.key))
  })

  it('canonical keys: one id per slot, accessories sorted; ids are collision-resistant', () => {
    const p = [
      { item: { id: 'b1' }, slot: 'bottom' as const },
      { item: { id: 'acc_z' }, slot: 'accessory' as const },
      { item: { id: 't1' }, slot: 'top' as const },
      { item: { id: 'acc_a' }, slot: 'accessory' as const },
      { item: { id: 'f1' }, slot: 'footwear' as const },
    ]
    expect(outfitKey(p)).toBe('t:t1|b:b1|d:-|o:-|f:f1|a:acc_a,acc_z')
    expect(outfitKey([...p].reverse())).toBe(outfitKey(p))
    expect(keyId('t:a|b:b')).not.toBe(keyId('t:a|b:c'))
    expect(keyId('x')).toMatch(/^o_[0-9a-f]{20}$/)
  })

  it('no seed → the best outfits; a seed → a deterministic window of the pool; same seed → same result', () => {
    const w = wardrobe()
    const best = generateOutfits({ wardrobe: w, weather: W(15), topN: 3 })
    const pool = generateOutfits({ wardrobe: w, weather: W(15), topN: 5 })
    expect(best.map((o) => o.mainKey)).toEqual(pool.slice(0, 3).map((o) => o.mainKey))
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const results = seeds.map((seed) => generateOutfits({ wardrobe: w, weather: W(15), topN: 3, seed }).map((o) => o.mainKey).join())
    expect(new Set(results).size).toBeGreaterThan(1) // another option exists
    for (const seed of seeds) {
      expect(generateOutfits({ wardrobe: w, weather: W(15), topN: 3, seed }).map((o) => o.mainKey).join()).toBe(results[seeds.indexOf(seed)])
    }
  })

  it('selectWithSeed: windows of the pool, filled from the start; best first within the window', () => {
    const mk = (k: number) => ({ key: `k${k}`, rawScore: 100 - k, signals: {}, items: [] }) as unknown as OutfitCandidate
    const pool = Array.from({ length: 7 }, (_, k) => mk(k))
    expect(selectWithSeed(pool, 3, undefined).map((c) => c.key)).toEqual(['k0', 'k1', 'k2'])
    const window = (seed: number) => selectWithSeed(pool, 3, seed).map((c) => c.key)
    for (let seed = 0; seed < 20; seed++) {
      const w = window(seed)
      expect(w).toHaveLength(3)
      expect(new Set(w).size).toBe(3)
      const start = (seedHash(seed) % 3) * 3
      expect(w).toContain(`k${start}`)
    }
    expect(seedHash(42)).toBe(seedHash(42))
  })

  it('variety: an item appears in at most MAX_ITEM_REPEAT pooled outfits when alternatives exist', () => {
    const r = generateOutfits({ wardrobe: wardrobe(), weather: W(15), topN: 5 })
    const uses = new Map<string, number>()
    for (const o of r) for (const i of o.items) if (i.slot !== 'accessory') uses.set(i.item.id, (uses.get(i.item.id) ?? 0) + 1)
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(MAX_ITEM_REPEAT)
    const fake = (id: string, items: string[], s: number) => ({ key: id, rawScore: s, signals: {}, items: items.map((x) => ({ item: { id: x } })) }) as unknown as OutfitCandidate
    const pool = varietyPool([fake('a', ['t1'], 90), fake('b', ['t1'], 89), fake('c', ['t1'], 88), fake('d', ['t2'], 50)], 3)
    expect(pool.map((c) => c.key)).toEqual(['a', 'b', 'd'])
    // Repeats fill remaining places only after every varied candidate.
    const filled = varietyPool([fake('a', ['t1'], 90), fake('b', ['t1'], 89), fake('c', ['t1'], 88), fake('d', ['t2'], 50)], 4)
    expect(filled.map((c) => c.key)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('reasons have readable labels in a fixed order; no internal "color:" codes', () => {
    const [o] = generateOutfits({ wardrobe: wardrobe(), weather: W(1), occasion: 'casual' })
    expect(o.reasonLabels).toHaveLength(o.reasons.length)
    expect(o.reasonLabels.every((l) => /^[A-ZÀ-ž]/.test(l) && !l.includes('_'))).toBe(true)
    expect(o.reasons.some((r) => r.startsWith('color:'))).toBe(false)
  })

  it('a rejected composition: feedback signal 5, and below every other one even when it scores far higher', () => {
    const w = [oxford(), chinos(), loafers(), knit(), item('shoes', 'boots', ['orange'])]
    const [best] = generateOutfits({ wardrobe: w, weather: W(30), occasion: 'work' })
    const after = generateOutfits({ wardrobe: w, weather: W(30), occasion: 'work', topN: 5, feedback: { rejectedItemIds: [], likedItemIds: [], rejectedOutfitKeys: [best.mainKey] } })
    const last = after[after.length - 1]
    expect(last.mainKey).toBe(best.mainKey)
    expect(last.signals.feedback).toBe(5)
    expect(last.factors.feedback).toBe(5)
    expect(after[0].signals.feedback).toBe(70)
    expect(last.rawScore).toBeGreaterThan(after[0].rawScore) // only the demotion puts it last
  })

  it('rejected compositions (feedback) drop down; liked items rise', () => {
    const w = [tee(), oxford(), jeans(), sneakers()]
    const [first] = generateOutfits({ wardrobe: w })
    const after = generateOutfits({ wardrobe: w, feedback: { rejectedItemIds: [], likedItemIds: [], rejectedOutfitKeys: [first.mainKey] }, topN: 2 })
    expect(after[0].mainKey).not.toBe(first.mainKey)
    expect(after[1].mainKey).toBe(first.mainKey) // still offered when little else exists
    const seeded = generateOutfits({ wardrobe: w, feedback: { rejectedItemIds: [], likedItemIds: [], rejectedOutfitKeys: [first.mainKey] }, topN: 1, seed: 3 })
    expect(seeded[0].mainKey).not.toBe(first.mainKey)
  })
})

// ─── Edge cases and scale ───────────────────────────────────────────────────

describe('edge cases and bounded generation', () => {
  it.each([
    ['empty wardrobe', [], 'empty_wardrobe'],
    ['only tops', [tee(), oxford()], 'no_footwear'],
    ['only bottoms', [jeans()], 'no_footwear'],
    ['only footwear', [sneakers(), boots()], 'no_main_pieces'],
    ['tops and shoes, no bottoms', [tee(), sneakers()], 'no_main_pieces'],
    ['only outerwear and shoes', [coat(), boots()], 'no_main_pieces'],
  ] as Array<[string, WardrobeItemSummary[], string]>)('%s → no outfit, problem %s', (_n, w, problem) => {
    const r = generateOutfitResult({ wardrobe: w })
    expect(r.outfits).toEqual([])
    expect(r.problem).toBe(problem)
  })

  it('unknown categories are ignored, never forced into a slot', () => {
    expect(generateOutfits({ wardrobe: [item('hat', null, []), tee(), jeans(), sneakers()] })[0].items).toHaveLength(3)
  })

  it('no outerwear in the wardrobe: cold still gives an outfit, with a lower layering score', () => {
    const r = generateOutfits({ wardrobe: [knit(), jeans(), boots()], weather: W(1) })
    expect(r).toHaveLength(1)
    expect(r[0].signals.layering!).toBeLessThan(80)
  })

  it('a very large wardrobe stays bounded: finalists per slot, ≤ MAX_CANDIDATES combinations, fast', () => {
    const big: WardrobeItemSummary[] = []
    const palette = ['white', 'black', 'navy', 'beige', 'gray', 'blue', 'olive', 'burgundy']
    const add = (cat: string, sub: string, count: number) => {
      for (let i = 0; i < count; i++) big.push(item(cat, sub, [palette[i % palette.length]], { style: i % 2 ? 'casual' : 'smart_casual' }))
    }
    add('shirt', 'oxford_shirt', 100)
    add('pants', 'chinos', 100)
    add('shoes', 'loafers', 30)
    add('outerwear', 'jacket', 25)
    add('dress', 'midi_dress', 20)
    add('accessory', 'watch', 15)
    add('bag', 'tote', 10)
    const t0 = performance.now()
    const r = generateOutfitResult({ wardrobe: big, weather: W(15), occasion: 'work', topN: 5 })
    const ms = performance.now() - t0
    const bound = SLOT_LIMITS.top * SLOT_LIMITS.bottom * SLOT_LIMITS.footwear * (SLOT_LIMITS.outerwear + 1) + SLOT_LIMITS.dress * SLOT_LIMITS.footwear * (SLOT_LIMITS.outerwear + 1)
    expect(r.evaluated).toBeLessThanOrEqual(Math.min(bound, MAX_CANDIDATES))
    expect(r.evaluated).toBeLessThan(100 * 100 * 30) // the old full Cartesian product
    expect(r.outfits).toHaveLength(5)
    expect(ms).toBeLessThan(2000)
    // deterministic at scale too
    expect(generateOutfitResult({ wardrobe: [...big].reverse(), weather: W(15), occasion: 'work', topN: 5 }).outfits).toEqual(r.outfits)
  })

  it('pool and limits are explicit constants', () => {
    expect(POOL_SIZE).toBeGreaterThanOrEqual(5)
    expect(SLOT_LIMITS).toEqual({ top: 12, bottom: 10, dress: 8, outerwear: 4, footwear: 6 })
  })
})
