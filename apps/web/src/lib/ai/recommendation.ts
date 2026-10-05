/**
 * Outfit Recommendation Engine — spec section 12.
 *
 * Pipeline (NOT a single LLM prompt):
 *   user request + weather + occasion + profile + feedback history
 *   → retrieve relevant wardrobe items
 *   → filter unsuitable items (weather-incompatible)
 *   → generate candidate outfits (top + bottom + shoes combos)
 *   → calculate 8-factor compatibility score
 *   → rank candidates by weighted score
 *   → return top N with reasons (LLM explanation added separately)
 *
 * Spec rule: "LLM should NOT be the sole recommendation engine."
 * This module is pure deterministic scoring — no LLM calls. The LLM is
 * called separately to wrap the result in natural language.
 */

import {
  scoreOutfitColors,
  scoreColorForOccasion,
  contrastLevel,
  type Occasion,
} from './color-theory'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WardrobeItemSummary {
  id: string
  category: string // shirt | outerwear | pants | dress | shoes | bag | accessory
  subcategory: string | null
  colors: string[]
  pattern: string | null
  material: string | null
  sleeveLength: string | null
  fit: string | null
  style: string | null
  season: string[]
  gender: string | null
  formality: string | null
}

export interface WeatherSnapshot {
  temperature: number
  feelsLike: number
  condition: string
  precipitationProbability: number
  humidity: number
  windSpeed: number
  uvIndex: number
}

/** Narrow a partial, client-supplied weather object to a full snapshot. */
export function isCompleteWeather(w: Partial<WeatherSnapshot> | null | undefined): w is WeatherSnapshot {
  if (!w) return false
  return (
    typeof w.temperature === 'number' &&
    typeof w.feelsLike === 'number' &&
    typeof w.condition === 'string' &&
    typeof w.precipitationProbability === 'number' &&
    typeof w.humidity === 'number' &&
    typeof w.windSpeed === 'number' &&
    typeof w.uvIndex === 'number'
  )
}

export interface UserProfileSummary {
  gender?: string | null
  preferredStyles?: string[]
  dislikedStyles?: string[]
  favoriteColors?: string[]
  dislikedColors?: string[]
  preferredFit?: string | null
}

export interface OutfitFeedbackHint {
  /** Item ids that appear in outfits the user has previously disliked. */
  rejectedItemIds: string[]
  /** Item ids the user has liked in the past. */
  likedItemIds: string[]
}

export interface GenerateInput {
  wardrobe: WardrobeItemSummary[]
  weather?: WeatherSnapshot
  occasion?: Occasion
  profile?: UserProfileSummary
  feedback?: OutfitFeedbackHint
  /** How many candidates to return (default 3) */
  topN?: number
  /** Seed for the randomization tiebreaker (so refresh re-rolls). */
  seed?: number
}

export interface OutfitCandidate {
  /** Stable hash of the item ids — used as a temp id before persistence. */
  tempId: string
  items: Array<{
    item: WardrobeItemSummary
    role: 'top' | 'bottom' | 'shoes' | 'accessory'
  }>
  score: number
  factors: {
    weather: number
    color: number
    occasion: number
    style: number
    season: number
    balance: number
    preference: number
    feedback: number
  }
  reasons: string[]
  contrastLevel: 'low' | 'medium' | 'high'
}

// ─── Role classification ────────────────────────────────────────────────────

function roleForCategory(cat: string): 'top' | 'bottom' | 'shoes' | 'accessory' | 'dress' | null {
  switch (cat) {
    case 'shirt':
    case 'outerwear':
      return 'top'
    case 'pants':
      return 'bottom'
    case 'shoes':
      return 'shoes'
    case 'bag':
    case 'accessory':
      return 'accessory'
    case 'dress':
      return 'dress'
    default:
      return null
  }
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/** Weather suitability — spec section 12 "weather compatibility". */
function weatherSuitabilityScore(
  item: WardrobeItemSummary,
  weather?: WeatherSnapshot,
): number {
  if (!weather) return 70 // neutral when no weather

  const temp = weather.temperature
  const season = item.season

  // Hot (>28°C): summer items are great, winter items penalised
  if (temp >= 28) {
    if (season.includes('summer')) return 95
    if (season.includes('spring') || season.includes('autumn')) return 60
    if (season.includes('winter')) return 25
    return 50
  }
  // Warm (18-27°C): spring/autumn items great, summer ok
  if (temp >= 18) {
    if (season.includes('spring') || season.includes('autumn')) return 92
    if (season.includes('summer')) return 80
    if (season.includes('winter')) return 45
    return 60
  }
  // Cool (5-17°C): spring/autumn/winter
  if (temp >= 5) {
    if (season.includes('autumn') || season.includes('winter')) return 90
    if (season.includes('spring')) return 75
    if (season.includes('summer')) return 40
    return 55
  }
  // Cold (<5°C): winter only
  if (season.includes('winter')) return 95
  if (season.includes('autumn')) return 60
  if (season.includes('spring')) return 35
  if (season.includes('summer')) return 15
  return 40
}

/** Material weather bonus — linen/cotton for hot, wool for cold. */
function materialWeatherScore(
  item: WardrobeItemSummary,
  weather?: WeatherSnapshot,
): number {
  if (!weather || !item.material) return 0
  const temp = weather.temperature
  const m = item.material
  if (temp >= 28 && ['linen', 'cotton'].includes(m)) return 12
  if (temp < 5 && ['wool', 'cashmere'].includes(m)) return 12
  if (temp >= 28 && ['wool', 'cashmere'].includes(m)) return -15
  if (temp < 5 && ['linen'].includes(m)) return -15
  return 0
}

// ─── Style compatibility ─────────────────────────────────────────────────────

/** How well do item styles blend? Items with same/complementary style score higher. */
function styleCompatibilityScore(styles: (string | null)[]): number {
  const filtered = styles.filter((s): s is string => !!s)
  if (filtered.length === 0) return 60 // unknown → neutral
  const unique = new Set(filtered)
  if (unique.size === 1) return 95 // all same style → perfect harmony

  // Define style compatibility groups
  const groups: string[][] = [
    ['casual', 'sporty', 'streetwear'], // casual family
    ['smart_casual', 'minimal', 'classic'], // elevated casual family
    ['formal', 'classic', 'preppy'], // formal family
    ['bohemian', 'casual'], // boho-casual
  ]
  // Check if all styles fall within one group
  for (const g of groups) {
    if (filtered.every((s) => g.includes(s))) return 80
  }
  // Mixed style families → low score unless intentional
  return 45
}

// ─── Occasion compatibility ─────────────────────────────────────────────────

function occasionScore(item: WardrobeItemSummary, occasion?: Occasion): number {
  if (!occasion || !item.formality) return 70

  const expectedFormality: Record<Occasion, string[]> = {
    work: ['smart_casual', 'formal'],
    wedding: ['formal', 'black_tie'],
    date: ['smart_casual', 'casual'],
    travel: ['casual'],
    casual: ['casual', 'smart_casual'],
    other: ['casual', 'smart_casual', 'formal'],
  }
  const ok = expectedFormality[occasion]
  if (ok.includes(item.formality)) return 90
  // One step away — still acceptable
  const order = ['casual', 'smart_casual', 'formal', 'black_tie']
  const itemIdx = order.indexOf(item.formality)
  const expectedIdx = Math.min(...ok.map((f) => order.indexOf(f)))
  const distance = Math.abs(itemIdx - expectedIdx)
  if (distance === 1) return 70
  if (distance === 2) return 45
  return 25
}

// ─── User preference scoring ────────────────────────────────────────────────

function preferenceScore(
  items: WardrobeItemSummary[],
  profile?: UserProfileSummary,
): { score: number; matched: string[] } {
  if (!profile) return { score: 70, matched: [] }
  let total = 0
  let count = 0
  const matched: string[] = []

  for (const item of items) {
    let s = 70
    if (profile.preferredStyles && item.style && profile.preferredStyles.includes(item.style)) {
      s += 20
      matched.push(item.style)
    }
    if (profile.dislikedStyles && item.style && profile.dislikedStyles.includes(item.style)) {
      s -= 25
    }
    if (profile.favoriteColors && item.colors.some((c) => profile.favoriteColors!.includes(c))) {
      s += 12
    }
    if (profile.dislikedColors && item.colors.some((c) => profile.dislikedColors!.includes(c))) {
      s -= 20
    }
    if (profile.preferredFit && item.fit === profile.preferredFit) {
      s += 8
    }
    total += Math.max(0, Math.min(100, s))
    count += 1
  }
  return { score: count > 0 ? Math.round(total / count) : 70, matched }
}

// ─── Feedback-based adjustment ─────────────────────────────────────────────

function feedbackScore(
  items: WardrobeItemSummary[],
  feedback?: OutfitFeedbackHint,
): number {
  if (!feedback) return 70
  let s = 70
  for (const item of items) {
    if (feedback.rejectedItemIds.includes(item.id)) s -= 15
    if (feedback.likedItemIds.includes(item.id)) s += 10
  }
  return Math.max(0, Math.min(100, s))
}

// ─── Wardrobe balance ───────────────────────────────────────────────────────

function balanceScore(items: WardrobeItemSummary[]): number {
  // Higher when items come from different categories (more complete outfit)
  const categories = new Set(items.map((i) => i.category))
  if (categories.size >= 3) return 95
  if (categories.size === 2) return 80
  if (categories.size === 1) return 55
  return 40
}

// ─── Candidate generation ────────────────────────────────────────────────────

function* generateCandidates(
  tops: WardrobeItemSummary[],
  bottoms: WardrobeItemSummary[],
  shoes: WardrobeItemSummary[],
  accessories: WardrobeItemSummary[],
  // Dresses bypass top+bottom
  dresses: WardrobeItemSummary[],
): Generator<{
  top: WardrobeItemSummary | null
  bottom: WardrobeItemSummary | null
  shoes: WardrobeItemSummary | null
  accessory: WardrobeItemSummary | null
}> {
  // Dress path: dress + shoes + (optional accessory)
  for (const dress of dresses) {
    for (const shoe of shoes.length > 0 ? shoes : [null]) {
      yield { top: dress, bottom: null, shoes: shoe, accessory: null }
    }
  }
  // Standard path: top + bottom + shoes + (optional accessory)
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes.length > 0 ? shoes : [null]) {
        yield { top, bottom, shoes: shoe, accessory: null }
      }
    }
  }
  // Add accessories only to a sample of the top candidates (we'll re-score
  // + rerank downstream anyway — we don't want to blow up combinatorially).
  void accessories
}

// ─── Scoring weights — spec section 12 example factors ──────────────────────
const WEIGHTS = {
  weather: 0.18,
  color: 0.18,
  occasion: 0.15,
  style: 0.15,
  season: 0.10,
  balance: 0.08,
  preference: 0.10,
  feedback: 0.06,
}

function hashIds(ids: string[]): string {
  // Simple stable hash for tempId
  const sorted = [...ids].sort()
  let h = 0
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h = ((h << 5) - h + id.charCodeAt(i)) | 0
    }
  }
  return `o_${Math.abs(h).toString(36)}`
}

// Pseudo-random with seed — used for tiebreaker so "refresh" re-rolls
function seededRandom(seed: number): () => number {
  let s = seed || 1
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function generateOutfits(input: GenerateInput): OutfitCandidate[] {
  const { wardrobe, weather, occasion, profile, feedback, topN = 3, seed = Date.now() } = input

  // ── Partition wardrobe by role ───────────────────────────────────────────
  const tops: WardrobeItemSummary[] = []
  const bottoms: WardrobeItemSummary[] = []
  const shoes: WardrobeItemSummary[] = []
  const accessories: WardrobeItemSummary[] = []
  const dresses: WardrobeItemSummary[] = []

  for (const item of wardrobe) {
    const role = roleForCategory(item.category)
    if (role === 'top') tops.push(item)
    else if (role === 'bottom') bottoms.push(item)
    else if (role === 'shoes') shoes.push(item)
    else if (role === 'accessory') accessories.push(item)
    else if (role === 'dress') dresses.push(item)
  }

  // If we don't have at least 2 categories that can form an outfit,
  // we cannot generate a recommendation — return empty.
  const hasTopOrDress = tops.length > 0 || dresses.length > 0
  const hasBottom = bottoms.length > 0
  if (!hasTopOrDress || !hasBottom) {
    return []
  }

  // ── Generate + score all candidates ──────────────────────────────────────
  const rng = seededRandom(seed)
  const candidates: OutfitCandidate[] = []

  for (const combo of generateCandidates(tops, bottoms, shoes, accessories, dresses)) {
    const items: Array<{ item: WardrobeItemSummary; role: 'top' | 'bottom' | 'shoes' | 'accessory' }> = []
    if (combo.top) items.push({ item: combo.top, role: combo.top.category === 'dress' ? 'top' : 'top' })
    if (combo.bottom) items.push({ item: combo.bottom, role: 'bottom' })
    if (combo.shoes) items.push({ item: combo.shoes, role: 'shoes' })

    if (items.length < 2) continue

    // Factor: weather (avg across items) + small material bonus
    const weatherPerItem = items.map((i) => weatherSuitabilityScore(i.item, weather))
    const weatherAvg = weatherPerItem.reduce((a, b) => a + b, 0) / weatherPerItem.length
    const materialBonus = items.reduce((s, i) => s + materialWeatherScore(i.item, weather), 0)
    const weatherScore = Math.max(0, Math.min(100, Math.round(weatherAvg + materialBonus)))

    // Factor: color harmony
    const colorResult = scoreOutfitColors(items.map((i) => i.item.colors))

    // Factor: occasion (formality match per item + color suitability for occasion)
    const occasionItemAvg =
      items.reduce((s, i) => s + occasionScore(i.item, occasion), 0) / items.length
    const colorOccasion = occasion ? scoreColorForOccasion(items.map((i) => i.item.colors), occasion) : { score: 70, reason: null }
    const occasionScore_ = Math.round(0.6 * occasionItemAvg + 0.4 * colorOccasion.score)

    // Factor: style compatibility across items
    const styleScore = styleCompatibilityScore(items.map((i) => i.item.style))

    // Factor: season match (similar to weather but season-only, no material bonus)
    const seasonScore = weatherPerItem.length > 0
      ? Math.round(weatherPerItem.reduce((a, b) => a + b, 0) / weatherPerItem.length)
      : 70

    // Factor: wardrobe balance
    const balanceScore_ = balanceScore(items.map((i) => i.item))

    // Factor: user preference
    const pref = preferenceScore(items.map((i) => i.item), profile)

    // Factor: feedback (liked / rejected items)
    const feedbackScore_ = feedbackScore(items.map((i) => i.item), feedback)

    // Weighted final
    const finalScore = Math.round(
      weatherScore * WEIGHTS.weather +
        colorResult.score * WEIGHTS.color +
        occasionScore_ * WEIGHTS.occasion +
        styleScore * WEIGHTS.style +
        seasonScore * WEIGHTS.season +
        balanceScore_ * WEIGHTS.balance +
        pref.score * WEIGHTS.preference +
        feedbackScore_ * WEIGHTS.feedback,
    )

    // Build reasons array — only include factors where the score was high
    const reasons: string[] = []
    if (weatherScore >= 80) reasons.push('weather')
    if (colorResult.score >= 80) reasons.push('color_harmony')
    if (occasionScore_ >= 80) reasons.push('occasion')
    if (styleScore >= 80) reasons.push('style_match')
    if (seasonScore >= 80) reasons.push('season')
    if (pref.score >= 80) reasons.push('preference')
    if (colorOccasion.reason) {
      // include the specific color-for-occasion reason as a hint for the LLM
      reasons.push(`color:${colorOccasion.reason}`)
    }

    const cLevel = contrastLevel(items.map((i) => i.item.colors))

    candidates.push({
      tempId: hashIds(items.map((i) => i.item.id)),
      items,
      score: finalScore,
      factors: {
        weather: weatherScore,
        color: colorResult.score,
        occasion: occasionScore_,
        style: styleScore,
        season: seasonScore,
        balance: balanceScore_,
        preference: pref.score,
        feedback: feedbackScore_,
      },
      reasons,
      contrastLevel: cLevel,
    })
  }

  // ── Rank: by score desc, then by random tiebreaker for re-roll ───────────
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable but re-rollable tiebreaker
    return rng() - 0.5
  })

  // De-duplicate by item id set (a candidate could be generated twice via
  // different paths — e.g., dress+shoes with both shoes from shoe list)
  const seen = new Set<string>()
  const unique: OutfitCandidate[] = []
  for (const c of candidates) {
    const key = c.tempId
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }

  return unique.slice(0, topN)
}

// ─── LLM explanation helper ─────────────────────────────────────────────────

/**
 * Build a compact, structured context string for the LLM to write a
 * natural-language explanation of WHY an outfit scored well. The LLM does
 * NOT pick the outfit — it just explains the engine's choice.
 *
 * Spec section 17: "Nega?" expandable explanation block.
 */
export function buildExplanationContext(candidate: OutfitCandidate, occasion?: Occasion): string {
  const itemDescriptions = candidate.items.map((i, idx) => {
    const c = i.item.colors[0] ?? '?'
    return `[${String.fromCharCode(65 + idx)}] ${i.item.subcategory ?? i.item.category} (${i.role}) | rang: ${c} | uslub: ${i.item.style ?? '?'} | mavsum: ${i.item.season.join(',')}`
  })

  const factorLines = [
    `ob-havo mosligi: ${candidate.factors.weather}/100`,
    `rang uyg'unligi: ${candidate.factors.color}/100`,
    `tadbir mosligi: ${candidate.factors.occasion}/100`,
    `uslub mosligi: ${candidate.factors.style}/100`,
    `mavsum mosligi: ${candidate.factors.season}/100`,
    `garderob balansi: ${candidate.factors.balance}/100`,
    `foydalanuvchi afzalligi: ${candidate.factors.preference}/100`,
  ].join('\n')

  return [
    'Siz AI stilist javobingiz uchun ushbu outfit haqida tabiiy o\'zbek tilida qisqa izoh yozing (2-3 jumla, maksimal 60 so\'z).',
    'Umumiy ball: ' + candidate.score + '/100',
    occasion ? `Tadbir: ${occasion}` : '',
    'Kontrast darajasi: ' + candidate.contrastLevel,
    '',
    'OUTFIT TARKIBI:',
    ...itemDescriptions,
    '',
    'FAKTORLAR:',
    factorLines,
    '',
    'Izoh qisqa, do\'stona va aniq bo\'lsin. "Nega shu outfit?" savoliga javob bering. Emoji ortiqcha emas.',
  ].filter(Boolean).join('\n')
}
