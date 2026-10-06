/**
 * Synthetic outfit-AI evaluation cases (Phase 4.5): weather, colour profile
 * and wardrobe-size variations. Catalog values only, synthetic ids (the model
 * never sees them: candidates are O1…On with attributes only).
 */
import type { Occasion } from '../../src/lib/ai/color-theory'
import type { ColorProfileInput, WardrobeItemSummary, WeatherSnapshot } from '../../src/lib/ai/outfit-engine'

export interface OutfitCase {
  id: string
  tags: string[]
  wardrobe: WardrobeItemSummary[]
  occasion?: Occasion
  weather?: WeatherSnapshot
  colorProfile?: ColorProfileInput | null
  topN: number
}

let seq = 0
const item = (category: string, subcategory: string, colors: string[], extra: Partial<WardrobeItemSummary> = {}): WardrobeItemSummary => ({
  id: `eval_o_${String(++seq).padStart(4, '0')}`,
  category,
  subcategory,
  colors,
  pattern: 'solid',
  material: 'cotton',
  sleeveLength: category === 'shirt' ? 'long' : null,
  fit: 'regular',
  style: 'casual',
  season: [],
  gender: 'unisex',
  formality: 'casual',
  ...extra,
})

export function mediumWardrobe(): WardrobeItemSummary[] {
  return [
    item('shirt', 'tshirt', ['white'], { sleeveLength: 'short', season: ['summer'] }),
    item('shirt', 'tshirt', ['navy'], { sleeveLength: 'short', season: ['summer'] }),
    item('shirt', 'oxford_shirt', ['light_blue'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'knit', ['beige'], { material: 'wool', season: ['autumn', 'winter'] }),
    item('shirt', 'polo', ['olive']),
    item('pants', 'jeans', ['blue'], { material: 'denim' }),
    item('pants', 'chinos', ['khaki'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('pants', 'shorts', ['navy'], { season: ['summer'] }),
    item('dress', 'midi_dress', ['burgundy'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('outerwear', 'coat', ['gray'], { material: 'wool', season: ['winter'] }),
    item('outerwear', 'windbreaker', ['olive']),
    item('outerwear', 'jacket', ['black'], { material: 'leather' }),
    item('shoes', 'sneakers', ['white']),
    item('shoes', 'loafers', ['brown'], { style: 'smart_casual', formality: 'smart_casual', material: 'leather' }),
    item('shoes', 'boots', ['black'], { material: 'leather', season: ['autumn', 'winter'] }),
    item('shoes', 'sandals', ['tan'], { season: ['summer'] }),
    item('accessory', 'scarf', ['gray'], { material: 'wool' }),
    item('accessory', 'sunglasses', ['black']),
  ]
}

function largeWardrobe(): WardrobeItemSummary[] {
  const colors = ['white', 'black', 'navy', 'beige', 'gray', 'blue', 'olive', 'burgundy', 'brown', 'khaki']
  const out: WardrobeItemSummary[] = []
  const add = (category: string, subs: string[], n: number) => {
    for (let i = 0; i < n; i++) out.push(item(category, subs[i % subs.length], [colors[(i * 3) % colors.length]], { style: i % 3 === 0 ? 'smart_casual' : 'casual', formality: i % 3 === 0 ? 'smart_casual' : 'casual' }))
  }
  add('shirt', ['tshirt', 'oxford_shirt', 'polo', 'knit'], 60)
  add('pants', ['jeans', 'chinos', 'trousers'], 50)
  add('dress', ['midi_dress', 'casual_dress'], 15)
  add('outerwear', ['jacket', 'coat', 'windbreaker', 'blazer'], 20)
  add('shoes', ['sneakers', 'loafers', 'boots'], 25)
  add('accessory', ['watch', 'belt', 'scarf'], 15)
  return out
}

const W = (t: number, condition: string, pct: number, wind = 8, uv = 3): WeatherSnapshot => ({ temperature: t, feelsLike: t, condition, precipitationProbability: pct, humidity: 60, windSpeed: wind, uvIndex: uv })
const profile = (confidence: number): ColorProfileInput => ({
  season: 'autumn', secondarySeason: null, undertone: 'warm', confidence, undertoneConfidence: confidence, secondaryConfidence: null,
  recommendedColors: ['olive', 'khaki', 'brown', 'beige', 'burgundy'], neutralColors: ['beige', 'brown'], cautionColors: ['black', 'white', 'light_blue'],
})

export function outfitCases(): OutfitCase[] {
  seq = 0
  return [
    { id: 'hot', tags: ['weather'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(34, 'clear', 0, 5, 9), topN: 3 },
    { id: 'cold', tags: ['weather'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(-2, 'cloudy', 10), topN: 3 },
    { id: 'rain', tags: ['weather'], wardrobe: mediumWardrobe(), occasion: 'work', weather: W(12, 'rain', 90, 15), topN: 3 },
    { id: 'snow', tags: ['weather'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(-5, 'snow', 80, 10), topN: 3 },
    { id: 'wind', tags: ['weather'], wardrobe: mediumWardrobe(), occasion: 'travel', weather: W(15, 'clear', 0, 55), topN: 3 },
    { id: 'no_weather', tags: ['weather', 'grounding'], wardrobe: mediumWardrobe(), occasion: 'date', topN: 3 },
    { id: 'profile_strong', tags: ['color_profile'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(18, 'clear', 0), colorProfile: profile(0.8), topN: 5 },
    { id: 'profile_weak', tags: ['color_profile', 'grounding'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(18, 'clear', 0), colorProfile: profile(0.2), topN: 5 },
    { id: 'profile_none', tags: ['color_profile', 'grounding'], wardrobe: mediumWardrobe(), occasion: 'casual', weather: W(18, 'clear', 0), colorProfile: null, topN: 5 },
    { id: 'small_wardrobe', tags: ['size'], wardrobe: [item('shirt', 'tshirt', ['white'], { sleeveLength: 'short' }), item('shirt', 'oxford_shirt', ['navy']), item('pants', 'jeans', ['blue']), item('shoes', 'sneakers', ['white'])], occasion: 'casual', weather: W(20, 'clear', 0), topN: 3 },
    { id: 'large_wardrobe', tags: ['size'], wardrobe: largeWardrobe(), occasion: 'work', weather: W(16, 'cloudy', 20), topN: 5 },
  ]
}
