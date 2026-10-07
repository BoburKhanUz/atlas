/**
 * Realistic outfit-context validation (Phase 5.2). The deterministic engine
 * (outfit-engine.ts, unchanged) is the source of truth; this checks it on 20
 * CONSTRUCTED everyday contexts against expectations written independently
 * of the engine's scoring (what a stylist would require), and reports every
 * failed check by case. A failed check is a finding for a later phase, never
 * a reason to change the engine here.
 *
 * Checked: structural validity (footwear + top/bottom or dress, no duplicate
 * or foreign items, at most one outer layer, no dress with bottoms), the
 * expected "no outfit" problem for incomplete wardrobes, weather rules (cold:
 * an outer layer when one exists, no shorts or sandals; heat: no coat or
 * wool knit; rain: no sandals), occasion rules (formal: no shorts, t-shirts
 * or sneakers), disliked colours avoided when possible, and determinism
 * (same input twice, shuffled wardrobe order). Colour harmony is a matter of
 * taste: NOT_EVALUATED here (needs human raters).
 */
import { generateOutfitResult, type GenerateInput, type GenerateProblem, type OutfitCandidate, type UserProfileSummary, type WardrobeItemSummary, type WeatherSnapshot } from '../../../src/lib/ai/outfit-engine'
import type { Occasion } from '../../../src/lib/ai/color-theory'
import type { Count } from './real-vision'

export const OUTFIT_REALISTIC_VERSION = 'constructed-v1'

let seq = 0
const item = (category: string, subcategory: string, colors: string[], extra: Partial<WardrobeItemSummary> = {}): WardrobeItemSummary => ({
  id: `rv_o_${String(++seq).padStart(4, '0')}`,
  category, subcategory, colors,
  pattern: 'solid', material: 'cotton', sleeveLength: category === 'shirt' ? 'long' : null, fit: 'regular',
  style: 'casual', season: [], gender: 'unisex', formality: 'casual',
  ...extra,
})
const W = (t: number, condition: string, pct: number, wind = 8): WeatherSnapshot => ({ temperature: t, feelsLike: t, condition, precipitationProbability: pct, humidity: 60, windSpeed: wind, uvIndex: 3 })

function everyday(): WardrobeItemSummary[] {
  return [
    item('shirt', 'tshirt', ['white'], { sleeveLength: 'short', season: ['summer'] }),
    item('shirt', 'tshirt', ['black'], { sleeveLength: 'short' }),
    item('shirt', 'polo', ['navy'], { sleeveLength: 'short', style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'oxford_shirt', ['white'], { style: 'formal', formality: 'formal' }),
    item('shirt', 'oxford_shirt', ['light_blue'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'knit', ['burgundy'], { material: 'wool', season: ['autumn', 'winter'] }),
    item('pants', 'jeans', ['blue'], { material: 'denim' }),
    item('pants', 'chinos', ['beige'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('pants', 'trousers', ['gray'], { style: 'formal', formality: 'formal', material: 'wool' }),
    item('pants', 'shorts', ['khaki'], { season: ['summer'] }),
    item('outerwear', 'blazer', ['navy'], { style: 'formal', formality: 'formal', material: 'wool' }),
    item('outerwear', 'coat', ['tan'], { material: 'wool', season: ['winter'] }),
    item('outerwear', 'windbreaker', ['olive']),
    item('shoes', 'sneakers', ['white']),
    item('shoes', 'oxford_shoes', ['brown'], { style: 'formal', formality: 'formal', material: 'leather' }),
    item('shoes', 'boots', ['black'], { material: 'leather', season: ['autumn', 'winter'] }),
    item('shoes', 'sandals', ['tan'], { season: ['summer'] }),
    item('accessory', 'scarf', ['gray'], { material: 'wool', season: ['winter'] }),
  ]
}
const noOuter = () => everyday().filter((i) => i.category !== 'outerwear')
const small = () => [item('shirt', 'tshirt', ['white'], { sleeveLength: 'short' }), item('pants', 'jeans', ['blue']), item('shoes', 'sneakers', ['white'])]
const large = () => {
  const colors = ['white', 'black', 'navy', 'beige', 'gray', 'blue', 'olive', 'burgundy', 'brown', 'khaki']
  const out: WardrobeItemSummary[] = []
  const add = (category: string, subs: string[], n: number) => { for (let i = 0; i < n; i++) out.push(item(category, subs[i % subs.length], [colors[(i * 3) % colors.length]], { style: i % 3 ? 'casual' : 'smart_casual', formality: i % 3 ? 'casual' : 'smart_casual' })) }
  add('shirt', ['tshirt', 'oxford_shirt', 'polo', 'knit'], 40); add('pants', ['jeans', 'chinos', 'trousers'], 30); add('outerwear', ['jacket', 'coat', 'blazer'], 12); add('shoes', ['sneakers', 'loafers', 'boots'], 15)
  return out
}

export interface OutfitExpect {
  /** The engine should report this problem (and no outfit). */
  problem?: GenerateProblem
  /** A formal occasion: no shorts, t-shirts or sneakers. */
  formal?: boolean
}

export interface RealisticOutfitCase {
  id: string
  tags: string[]
  wardrobe: WardrobeItemSummary[]
  occasion?: Occasion
  weather?: WeatherSnapshot
  profile?: UserProfileSummary
  expect: OutfitExpect
}

export function outfitRealisticCases(): RealisticOutfitCase[] {
  seq = 0
  return [
    { id: 'small_casual', tags: ['size'], wardrobe: small(), occasion: 'casual', weather: W(22, 'clear', 0), expect: {} },
    { id: 'large_work', tags: ['size'], wardrobe: large(), occasion: 'work', weather: W(17, 'cloudy', 10), expect: {} },
    { id: 'missing_shoes', tags: ['incomplete'], wardrobe: everyday().filter((i) => i.category !== 'shoes'), occasion: 'casual', expect: { problem: 'no_footwear' } },
    { id: 'missing_bottoms', tags: ['incomplete'], wardrobe: everyday().filter((i) => i.category !== 'pants'), occasion: 'casual', expect: { problem: 'no_main_pieces' } },
    { id: 'empty', tags: ['incomplete'], wardrobe: [], expect: { problem: 'empty_wardrobe' } },
    { id: 'cold_with_outer', tags: ['weather'], wardrobe: everyday(), occasion: 'casual', weather: W(-2, 'cloudy', 10), expect: {} },
    { id: 'cold_no_outer', tags: ['weather'], wardrobe: noOuter(), occasion: 'casual', weather: W(1, 'clear', 0), expect: {} },
    { id: 'hot_casual', tags: ['weather'], wardrobe: everyday(), occasion: 'casual', weather: W(36, 'clear', 0, 4), expect: {} },
    { id: 'hot_work', tags: ['weather', 'occasion'], wardrobe: everyday(), occasion: 'work', weather: W(34, 'clear', 0), expect: {} },
    { id: 'rain_work', tags: ['weather', 'occasion'], wardrobe: everyday(), occasion: 'work', weather: W(11, 'rain', 90, 18), expect: {} },
    { id: 'rain_casual', tags: ['weather'], wardrobe: everyday(), occasion: 'casual', weather: W(16, 'rain', 80), expect: {} },
    { id: 'snow', tags: ['weather'], wardrobe: everyday(), occasion: 'casual', weather: W(-7, 'snow', 85, 12), expect: {} },
    { id: 'wedding_mild', tags: ['occasion'], wardrobe: everyday(), occasion: 'wedding', weather: W(22, 'clear', 0), expect: { formal: true } },
    { id: 'wedding_cold', tags: ['occasion', 'weather'], wardrobe: everyday(), occasion: 'wedding', weather: W(3, 'clear', 0), expect: { formal: true } },
    { id: 'date_evening', tags: ['occasion'], wardrobe: everyday(), occasion: 'date', weather: W(15, 'clear', 0), expect: {} },
    { id: 'travel_mixed', tags: ['occasion'], wardrobe: everyday(), occasion: 'travel', weather: W(19, 'partly_cloudy', 30), expect: {} },
    { id: 'outerwear_unneeded', tags: ['layering'], wardrobe: everyday(), occasion: 'casual', weather: W(27, 'clear', 0), expect: {} },
    { id: 'no_weather', tags: ['weather'], wardrobe: everyday(), occasion: 'casual', expect: {} },
    { id: 'pref_disliked_black', tags: ['preference'], wardrobe: everyday(), occasion: 'casual', weather: W(20, 'clear', 0), profile: { dislikedColors: ['black'] }, expect: {} },
    { id: 'pref_formal_style', tags: ['preference', 'occasion'], wardrobe: everyday(), occasion: 'work', weather: W(18, 'clear', 0), profile: { preferredStyles: ['formal'] }, expect: {} },
  ]
}

const sub = (o: OutfitCandidate) => o.items.map((i) => i.item.subcategory ?? '')
const cat = (o: OutfitCandidate) => o.items.map((i) => i.item.category)

/** Independent checks of one case's result; each returns the failed check names. */
export function checkOutfits(c: RealisticOutfitCase, outfits: OutfitCandidate[], problem: GenerateProblem | null): string[] {
  const failed: string[] = []
  if (c.expect.problem) {
    if (problem !== c.expect.problem || outfits.length) failed.push(`expected_problem:${c.expect.problem}`)
    return failed
  }
  if (!outfits.length) return [`no_outfit:${problem ?? 'none'}`]
  const ids = new Set(c.wardrobe.map((i) => i.id))
  const feels = c.weather?.feelsLike
  const hasOuter = c.wardrobe.some((i) => i.category === 'outerwear')
  const disliked = new Set(c.profile?.dislikedColors ?? [])
  const avoidable = disliked.size > 0
  for (const [n, o] of outfits.entries()) {
    const cats = cat(o), subs = sub(o)
    const tag = (s: string) => failed.push(`O${n + 1}:${s}`)
    if (!cats.includes('shoes')) tag('validity_no_footwear')
    if (!(cats.includes('dress') || (cats.includes('shirt') && cats.includes('pants')))) tag('validity_no_main_pieces')
    if (new Set(o.items.map((i) => i.item.id)).size !== o.items.length) tag('validity_duplicate_item')
    if (o.items.some((i) => !ids.has(i.item.id))) tag('validity_foreign_item')
    if (cats.filter((x) => x === 'outerwear').length > 1) tag('layering_two_outer_layers')
    if (cats.includes('dress') && cats.includes('pants')) tag('layering_dress_with_bottoms')
    if (feels !== undefined && feels <= 5) {
      if (hasOuter && !cats.includes('outerwear')) tag('weather_cold_without_outer_layer')
      if (subs.includes('shorts') || subs.includes('sandals')) tag('weather_cold_shorts_or_sandals')
    }
    if (feels !== undefined && feels >= 30 && (subs.includes('coat') || o.items.some((i) => i.item.subcategory === 'knit' && i.item.material === 'wool'))) tag('weather_heat_heavy_layer')
    if (c.weather && (c.weather.condition === 'rain' || c.weather.condition === 'snow') && subs.includes('sandals')) tag('weather_wet_sandals')
    if (c.expect.formal && (subs.includes('shorts') || subs.includes('tshirt') || subs.includes('sneakers'))) tag('occasion_formal_casual_piece')
    if (avoidable && n === 0 && o.items.some((i) => i.item.colors.some((col) => disliked.has(col)))) tag('preference_disliked_color_in_top_outfit')
  }
  return failed
}

export interface OutfitValidationReport {
  version: string
  cases: number
  status: 'EVALUATED'
  /** Cases with every check passing / cases. */
  casesPassing: Count
  byCheck: Record<string, number>
  failures: Array<{ case: string; failed: string[] }>
  deterministic: Count
  colorHarmony: 'NOT_EVALUATED'
}

const shuffled = <T,>(xs: T[]) => xs.map((x, i) => [x, (i * 7919) % 101] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)

export function runOutfitRealistic(): OutfitValidationReport {
  const cases = outfitRealisticCases()
  const failures: OutfitValidationReport['failures'] = []
  const byCheck: Record<string, number> = {}
  let stable = 0
  for (const c of cases) {
    const input: GenerateInput = { wardrobe: c.wardrobe, occasion: c.occasion, weather: c.weather, profile: c.profile, topN: 3 }
    const a = generateOutfitResult(input)
    const b = generateOutfitResult(input)
    const s = generateOutfitResult({ ...input, wardrobe: shuffled(c.wardrobe) })
    const key = (r: typeof a) => JSON.stringify([r.problem, r.outfits.map((o) => [o.key, o.score])])
    if (key(a) === key(b) && key(a) === key(s)) stable++
    const failed = checkOutfits(c, a.outfits, a.problem)
    for (const f of failed) { const k = f.replace(/^O\d+:/, ''); byCheck[k] = (byCheck[k] ?? 0) + 1 }
    if (failed.length) failures.push({ case: c.id, failed })
  }
  const count = (a: number, b: number): Count => ({ correct: a, scored: b, rate: b ? Math.round((a / b) * 10_000) / 10_000 : null })
  return { version: OUTFIT_REALISTIC_VERSION, cases: cases.length, status: 'EVALUATED', casesPassing: count(cases.length - failures.length, cases.length), byCheck, failures, deterministic: count(stable, cases.length), colorHarmony: 'NOT_EVALUATED' }
}
