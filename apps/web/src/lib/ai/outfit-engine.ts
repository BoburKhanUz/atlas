/**
 * Deterministic outfit engine (Phase 4.4). Pure: no database, no network, no
 * clock, no randomness. Same wardrobe + context + seed → same result.
 *
 *   wardrobe
 *   → hard eligibility (slot, weather safety, occasion — soft-excluded only
 *     when the slot keeps an alternative)
 *   → per-slot deterministic pre-ranking → bounded finalists
 *   → valid compositions only (top+bottom+shoes [+outerwear],
 *     dress+shoes [+outerwear]; layering rules per temperature band)
 *   → scoring (weather, occasion, colour, colour profile, style, layering,
 *     preference, feedback; unavailable signals are left out)
 *   → canonical de-duplication → stable sort → variety pool
 *   → seeded window selection → accessories ranked separately
 *
 * All thresholds and weights: ./outfit-config.ts. Docs: docs/ai/outfit-engine.md.
 */
import crypto from 'crypto'
import { getColorMeta, scoreColorForOccasion, scoreColorPair, contrastLevel, type Occasion } from './color-theory'
import { SEASONAL_PALETTES, type Season } from './color-analysis'
import {
  ACCESSORY_MIN_SCORE,
  CATEGORY_SLOT,
  CATEGORY_WARMTH,
  DRESSY_OCCASIONS,
  FORMALITY_ORDER,
  HIGH_UV,
  LEGACY_PROFILE_CONFIDENCE,
  MATERIAL_WARMTH,
  MAX_CANDIDATES,
  MAX_ITEM_REPEAT,
  MAX_TOP_N,
  OCCASION_FORMALITY,
  OFF_OCCASION_STYLES,
  POOL_SIZE,
  PROFILE_MIN_CONFIDENCE,
  PROFILE_SLOT_WEIGHT,
  PROTECTIVE_OUTERWEAR,
  RAIN_LIKELY_PCT,
  RAIN_POSSIBLE_PCT,
  SLEEVE_WARMTH,
  SLOT_AREA,
  SLOT_LIMITS,
  SLOT_WEIGHT,
  SNOW_FOOTWEAR,
  STRONG_WIND_KMH,
  STYLE_FAMILIES,
  STYLE_FORMALITY,
  SUBCATEGORY_FORMALITY,
  SUBCATEGORY_WARMTH,
  TARGET_WARMTH,
  TEMPERATURE_BANDS,
  UNDERTONE_MIN_CONFIDENCE,
  WEIGHTS,
  WET_FOOTWEAR,
  WET_SENSITIVE_MATERIALS,
  WINDY_KMH,
  type SignalName,
  type Slot,
  type TemperatureBand,
} from './outfit-config'

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface WardrobeItemSummary {
  id: string
  category: string
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

export interface UserProfileSummary {
  gender?: string | null
  preferredStyles?: string[]
  dislikedStyles?: string[]
  favoriteColors?: string[]
  dislikedColors?: string[]
  preferredFit?: string | null
}

/** The stored Phase 4.3 colour profile (never fabricated: null when there is none). */
export interface ColorProfileInput {
  season: string | null
  secondarySeason: string | null
  undertone: string | null
  /** null for profiles from before Phase 4.3. */
  confidence: number | null
  undertoneConfidence: number | null
  secondaryConfidence: number | null
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
}

export interface OutfitFeedbackHint {
  rejectedItemIds: string[]
  likedItemIds: string[]
  /** Canonical main-composition keys (outfitKey) of rejected outfits. */
  rejectedOutfitKeys?: string[]
}

export interface GenerateInput {
  wardrobe: WardrobeItemSummary[]
  /** Only the fields actually known; nothing is assumed for the rest. */
  weather?: Partial<WeatherSnapshot>
  occasion?: Occasion
  profile?: UserProfileSummary
  colorProfile?: ColorProfileInput | null
  feedback?: OutfitFeedbackHint
  /** Outfits to return (1–5, default 3). */
  topN?: number
  /** Omitted: the best outfits. Given: a deterministic window of the top candidates ("another option"). */
  seed?: number
}

// ─── Outputs ────────────────────────────────────────────────────────────────

/** Compatible with the API's `role` before Phase 4.4 (dress and outerwear were "top"). */
export type LegacyRole = 'top' | 'bottom' | 'shoes' | 'accessory'

export interface OutfitCandidate {
  /** Collision-resistant id derived from the canonical key. */
  tempId: string
  /** Canonical composition key (accessories sorted). */
  key: string
  /** Canonical key of the main composition, without accessories (feedback, de-duplication). */
  mainKey: string
  items: Array<{ item: WardrobeItemSummary; role: LegacyRole; slot: Slot }>
  /** 0–100, rounded. */
  score: number
  /** Unrounded score used for ordering. */
  rawScore: number
  /** Available signals only (0–100). */
  signals: Partial<Record<SignalName, number>>
  /** Legacy factor names (50 = no information for that factor). */
  factors: { weather: number; color: number; occasion: number; style: number; season: number; balance: number; preference: number; feedback: number }
  /** Internal reason codes (fixed order). */
  reasons: string[]
  /** User-facing Uzbek labels for `reasons`. */
  reasonLabels: string[]
  contrastLevel: 'low' | 'medium' | 'high'
}

export type GenerateProblem = 'empty_wardrobe' | 'no_footwear' | 'no_main_pieces' | 'nothing_suitable'

export interface GenerateResult {
  outfits: OutfitCandidate[]
  /** Why there are no outfits (null when there are some). */
  problem: GenerateProblem | null
  /** Combinations scored (bounded by MAX_CANDIDATES). */
  evaluated: number
  weather: WeatherContext | null
}

// ─── Weather context ────────────────────────────────────────────────────────

export interface WeatherContext {
  band: TemperatureBand | null
  feelsLike: number | null
  wet: 'likely' | 'possible' | 'no' | null
  snow: boolean | null
  wind: 'strong' | 'windy' | 'calm' | null
  uvHigh: boolean | null
  /** 0–1: share of the weather dimensions (temperature, precipitation, wind) that are known. */
  completeness: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function bandOf(feelsLike: number): TemperatureBand {
  let band: TemperatureBand = 'very_cold'
  for (const b of TEMPERATURE_BANDS) if (feelsLike >= b.from) band = b.band
  return band
}

/** Derives what is known about the weather; unknown stays unknown (null). */
export function weatherContext(w: Partial<WeatherSnapshot> | undefined | null): WeatherContext | null {
  if (!w) return null
  const feels = finite(w.feelsLike) ? w.feelsLike : finite(w.temperature) ? w.temperature : null
  const condition = typeof w.condition === 'string' && w.condition ? w.condition : null
  const pct = finite(w.precipitationProbability) ? w.precipitationProbability : null
  let wet: WeatherContext['wet'] = null
  if (condition === 'rain' || condition === 'thunderstorm') wet = 'likely'
  else if (pct !== null) wet = pct >= RAIN_LIKELY_PCT ? 'likely' : pct >= RAIN_POSSIBLE_PCT ? 'possible' : 'no'
  else if (condition) wet = 'no'
  const wind = finite(w.windSpeed) ? (w.windSpeed >= STRONG_WIND_KMH ? 'strong' : w.windSpeed >= WINDY_KMH ? 'windy' : 'calm') : null
  const known = [feels !== null, wet !== null || condition === 'snow', wind !== null]
  const completeness = known.filter(Boolean).length / known.length
  if (completeness === 0) return null
  return {
    band: feels === null ? null : bandOf(feels),
    feelsLike: feels,
    wet,
    snow: condition === null ? null : condition === 'snow',
    wind,
    uvHigh: finite(w.uvIndex) ? w.uvIndex >= HIGH_UV : null,
    completeness,
  }
}

// ─── Item semantics ─────────────────────────────────────────────────────────

export const slotOf = (item: WardrobeItemSummary): Slot | null => CATEGORY_SLOT[item.category] ?? null

export function legacyRole(slot: Slot): LegacyRole {
  if (slot === 'bottom') return 'bottom'
  if (slot === 'footwear') return 'shoes'
  if (slot === 'accessory') return 'accessory'
  return 'top' // top, dress and outerwear were all "top" before Phase 4.4
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 0 (very light) … 3 (very warm). */
export function warmthOf(item: WardrobeItemSummary): number {
  let w = (item.subcategory ? SUBCATEGORY_WARMTH[item.subcategory] : undefined) ?? CATEGORY_WARMTH[item.category] ?? 1
  if (item.material) w += MATERIAL_WARMTH[item.material] ?? 0
  if ((item.category === 'shirt' || item.category === 'dress') && item.sleeveLength) w += SLEEVE_WARMTH[item.sleeveLength] ?? 0
  return clamp(w, 0, 3)
}

export function formalityOf(item: WardrobeItemSummary): string | null {
  return item.formality ?? (item.subcategory ? SUBCATEGORY_FORMALITY[item.subcategory] : undefined) ?? (item.style ? STYLE_FORMALITY[item.style] : undefined) ?? null
}

const isShortSleeved = (item: WardrobeItemSummary) => item.sleeveLength === 'short' || item.sleeveLength === 'sleeveless' || item.subcategory === 'tshirt'

/** An outer layer over shorts or sandals is never a coherent outfit (warm and exposed at once). */
export function exposedWithOuterwear(bottom: WardrobeItemSummary | null, shoes: WardrobeItemSummary | null): boolean {
  return bottom?.subcategory === 'shorts' || shoes?.subcategory === 'sandals'
}

// ─── Hard eligibility ───────────────────────────────────────────────────────

/** Unsuitable in this weather whatever else the wardrobe holds. */
export function weatherExcludes(item: WardrobeItemSummary, slot: Slot, wx: WeatherContext | null): boolean {
  if (!wx) return false
  const cold = wx.band === 'very_cold' || wx.band === 'cold'
  if (cold && (item.subcategory === 'shorts' || item.subcategory === 'sandals')) return true
  if (wx.band === 'hot' && slot === 'outerwear' && warmthOf(item) >= 2) return true
  if ((wx.snow || wx.wet === 'likely') && item.subcategory === 'sandals') return true
  if (slot === 'accessory') {
    if (item.subcategory === 'sunglasses' && (wx.snow || wx.wet === 'likely')) return true
    if (item.subcategory === 'hat' && wx.wind === 'strong') return true
  }
  return false
}

/** Wrong for the occasion: removed only when the slot keeps an alternative. */
export function occasionDiscourages(item: WardrobeItemSummary, occasion: Occasion | undefined): boolean {
  if (!occasion) return false
  if (item.style && OFF_OCCASION_STYLES[occasion]?.has(item.style)) return true
  return DRESSY_OCCASIONS.has(occasion) && formalityOf(item) === 'casual'
}

// ─── Single-item fit (pre-ranking and accessories) ──────────────────────────

function formalityFit(item: WardrobeItemSummary, occasion: Occasion | undefined): number | null {
  const f = formalityOf(item)
  if (!occasion || !f) return null
  const ok = OCCASION_FORMALITY[occasion] ?? []
  if (ok.includes(f)) return 100
  const idx = FORMALITY_ORDER.indexOf(f as (typeof FORMALITY_ORDER)[number])
  const distance = Math.min(...ok.map((o) => Math.abs(FORMALITY_ORDER.indexOf(o as (typeof FORMALITY_ORDER)[number]) - idx)))
  return [100, 65, 35, 10][Math.min(distance, 3)]
}

const BAND_SEASONS: Record<TemperatureBand, readonly string[]> = {
  very_cold: ['winter'],
  cold: ['winter', 'autumn'],
  mild: ['spring', 'autumn'],
  warm: ['spring', 'summer'],
  hot: ['summer'],
}

function seasonTagFit(item: WardrobeItemSummary, wx: WeatherContext | null): number | null {
  if (!wx?.band || item.season.length === 0) return null
  return item.season.some((s) => BAND_SEASONS[wx.band!].includes(s)) ? 100 : 30
}

function preferenceFit(item: WardrobeItemSummary, p: UserProfileSummary | undefined): number | null {
  if (!p) return null
  const any = [p.preferredStyles, p.dislikedStyles, p.favoriteColors, p.dislikedColors].some((l) => (l?.length ?? 0) > 0) || !!p.preferredFit
  if (!any) return null
  let s = 70
  if (item.style && p.preferredStyles?.includes(item.style)) s += 20
  if (item.style && p.dislikedStyles?.includes(item.style)) s -= 30
  if (item.colors.some((c) => p.favoriteColors?.includes(c))) s += 12
  if (item.colors.some((c) => p.dislikedColors?.includes(c))) s -= 25
  if (p.preferredFit && item.fit === p.preferredFit) s += 8
  return clamp(s, 0, 100)
}

function itemFeedback(item: WardrobeItemSummary, fb: OutfitFeedbackHint | undefined): number | null {
  if (!fb || (fb.rejectedItemIds.length === 0 && fb.likedItemIds.length === 0)) return null
  let s = 70
  if (fb.rejectedItemIds.includes(item.id)) s -= 25
  if (fb.likedItemIds.includes(item.id)) s += 15
  return clamp(s, 0, 100)
}

function itemWeatherFit(item: WardrobeItemSummary, slot: Slot, wx: WeatherContext | null): number | null {
  if (!wx) return null
  const parts: number[] = []
  if (wx.band) {
    const w = warmthOf(item)
    const ideal: Record<TemperatureBand, number> = { very_cold: 3, cold: 2.5, mild: 1.5, warm: 1, hot: 0.3 }
    parts.push(100 - 25 * Math.abs(w - ideal[wx.band]))
  }
  if (slot === 'footwear' && (wx.wet === 'likely' || wx.snow)) parts.push(item.subcategory && (wx.snow ? SNOW_FOOTWEAR : WET_FOOTWEAR).has(item.subcategory) ? 100 : 40)
  if (slot === 'outerwear' && (wx.wet === 'likely' || wx.wind === 'windy' || wx.wind === 'strong')) parts.push(item.subcategory && PROTECTIVE_OUTERWEAR.has(item.subcategory) ? 100 : 50)
  const tag = seasonTagFit(item, wx)
  if (tag !== null) parts.push(tag)
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

/** Pre-ranking score of one item for its slot (deterministic). */
function itemRank(item: WardrobeItemSummary, slot: Slot, ctx: Ctx): number {
  const parts: Array<[number | null, number]> = [
    [itemWeatherFit(item, slot, ctx.wx), 0.35],
    [formalityFit(item, ctx.occasion), 0.3],
    [preferenceFit(item, ctx.profile), 0.15],
    [PROFILE_SLOT_WEIGHT[slot] > 0 ? profileColorFit(item.colors[0], ctx.cp) : null, 0.1],
    [itemFeedback(item, ctx.feedback), 0.1],
  ]
  let num = 0, den = 0
  for (const [v, w] of parts) {
    if (v === null) continue
    num += v * w
    den += w
  }
  return den ? num / den : 50
}

// ─── Colour profile ─────────────────────────────────────────────────────────

interface ProfileCtx {
  strength: number
  recommended: Set<string>
  neutral: Set<string>
  caution: Set<string>
  secondary: Set<string>
  undertone: 'warm' | 'cool' | null
}

/** The usable part of a profile, or null when it should not influence anything. */
export function profileContext(cp: ColorProfileInput | null | undefined): ProfileCtx | null {
  if (!cp) return null
  const strength = cp.confidence ?? LEGACY_PROFILE_CONFIDENCE
  const undertoneReliable = (cp.undertoneConfidence ?? (cp.confidence === null ? LEGACY_PROFILE_CONFIDENCE : 0)) >= UNDERTONE_MIN_CONFIDENCE
  const undertone =
    undertoneReliable && cp.undertone && ['warm', 'neutral_warm'].includes(cp.undertone) ? 'warm'
    : undertoneReliable && cp.undertone && ['cool', 'neutral_cool'].includes(cp.undertone) ? 'cool'
    : null
  if (strength < PROFILE_MIN_CONFIDENCE || (!cp.season && !undertone)) return null
  const secondaryOk = cp.secondarySeason && (cp.secondaryConfidence ?? 0) >= 0.2 && cp.secondarySeason in SEASONAL_PALETTES
  return {
    strength,
    recommended: new Set(cp.season ? cp.recommendedColors : []),
    neutral: new Set(cp.season ? cp.neutralColors : []),
    caution: new Set(cp.season ? cp.cautionColors : []),
    secondary: new Set(secondaryOk ? SEASONAL_PALETTES[cp.secondarySeason as Season].recommended : []),
    undertone,
  }
}

function profileColorFit(color: string | undefined, cp: ProfileCtx | null): number | null {
  if (!cp || !color) return null
  let s = cp.caution.has(color) ? 20 : cp.recommended.has(color) ? 100 : cp.neutral.has(color) ? 80 : cp.secondary.has(color) ? 75 : 55
  const t = getColorMeta(color)?.temperature
  if (cp.undertone && t && t !== 'neutral') s += t === cp.undertone ? 10 : -10
  return clamp(s, 0, 100)
}

// ─── Outfit signals ─────────────────────────────────────────────────────────

interface Ctx {
  wx: WeatherContext | null
  occasion: Occasion | undefined
  profile: UserProfileSummary | undefined
  cp: ProfileCtx | null
  feedback: OutfitFeedbackHint | undefined
  outerwearAvailable: boolean
}

type Piece = { item: WardrobeItemSummary; slot: Slot }

function weightedMean(values: Array<[number | null, number]>): number | null {
  let num = 0, den = 0
  for (const [v, w] of values) {
    if (v === null || w <= 0) continue
    num += v * w
    den += w
  }
  return den ? num / den : null
}

function weatherSignal(pieces: Piece[], ctx: Ctx): { score: number; availability: number; season: number | null } | null {
  const wx = ctx.wx
  if (!wx) return null
  const parts: Array<[number | null, number]> = []
  if (wx.band) {
    const total = pieces.reduce((s, p) => s + warmthOf(p.item), 0)
    const t = TARGET_WARMTH[wx.band]
    const distance = total < t.min ? t.min - total : total > t.max ? total - t.max : 0
    parts.push([clamp(100 - 18 * distance, 0, 100), 0.45])
  }
  const outer = pieces.find((p) => p.slot === 'outerwear')
  const shoes = pieces.find((p) => p.slot === 'footwear')
  const protective = !!outer?.item.subcategory && PROTECTIVE_OUTERWEAR.has(outer.item.subcategory)
  if (wx.wet === 'likely' || wx.wet === 'possible') {
    const k = wx.wet === 'likely' ? 1 : 0.5
    let s = 100
    if (!(shoes?.item.subcategory && WET_FOOTWEAR.has(shoes.item.subcategory))) s -= 30 * k
    if (!protective) s -= 25 * k
    s -= 12 * k * pieces.filter((p) => p.item.material && WET_SENSITIVE_MATERIALS.has(p.item.material)).length
    parts.push([clamp(s, 0, 100), 0.25])
  }
  if (wx.snow) parts.push([shoes?.item.subcategory && SNOW_FOOTWEAR.has(shoes.item.subcategory) ? 100 : 35, 0.25])
  if (wx.wind === 'windy' || wx.wind === 'strong') {
    const k = wx.wind === 'strong' ? 1 : 0.5
    let s = protective ? 100 : 100 - 30 * k
    s -= 6 * k * pieces.filter((p) => p.item.fit === 'oversized' || p.item.fit === 'relaxed').length
    if (pieces.some((p) => p.slot === 'dress')) s -= 10 * k
    parts.push([clamp(s, 0, 100), 0.2])
  }
  const season = weightedMean(pieces.map((p) => [seasonTagFit(p.item, wx), SLOT_WEIGHT[p.slot]]))
  if (season !== null) parts.push([season, 0.15])
  const score = weightedMean(parts)
  return score === null ? null : { score, availability: wx.completeness, season }
}

function occasionSignal(pieces: Piece[], ctx: Ctx): { score: number; availability: number } | null {
  if (!ctx.occasion) return null
  const formality = weightedMean(pieces.map((p) => [formalityFit(p.item, ctx.occasion), SLOT_WEIGHT[p.slot]]))
  const offStyle = pieces.filter((p) => p.item.style && OFF_OCCASION_STYLES[ctx.occasion!]?.has(p.item.style)).length
  const colors = pieces.map((p) => p.item.colors).filter((c) => c.length > 0)
  const colorPart = colors.length ? scoreColorForOccasion(colors, ctx.occasion).score : null
  const base = weightedMean([[formality, 0.75], [colorPart, 0.25]])
  if (base === null) return null
  return { score: clamp(base - 20 * offStyle, 0, 100), availability: formality === null ? 0.5 : 1 }
}

/** Dominant-colour harmony weighted by visual area, neutral balance, accent count and contrast. */
export function colorSignal(pieces: Piece[], occasion?: Occasion): number | null {
  const main = pieces.filter((p) => p.slot !== 'accessory' && p.item.colors.length > 0)
  if (main.length < 2) return null
  let num = 0, den = 0
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      const w = SLOT_AREA[main[i].slot] * SLOT_AREA[main[j].slot]
      // Dominant colours decide; secondary colours count a little.
      const dominant = scoreColorPair(main[i].item.colors[0], main[j].item.colors[0]).score
      const secondaryPairs = [...main[i].item.colors.slice(1).map((c) => [c, main[j].item.colors[0]]), ...main[j].item.colors.slice(1).map((c) => [main[i].item.colors[0], c])]
      const secondary = secondaryPairs.length ? secondaryPairs.reduce((s, [a, b]) => s + scoreColorPair(a, b).score, 0) / secondaryPairs.length : dominant
      num += w * (0.8 * dominant + 0.2 * secondary)
      den += w
    }
  }
  let s = num / den
  const metas = main.map((p) => getColorMeta(p.item.colors[0]))
  if (metas.some((m) => m?.isNeutral)) s += 5
  const accents = new Set(metas.filter((m) => m && !m.isNeutral).map((m) => Math.round(m!.hue / 30)))
  if (accents.size > 2) s -= 12 * (accents.size - 2)
  if (occasion && DRESSY_OCCASIONS.has(occasion) && contrastLevel(main.map((p) => [p.item.colors[0]])) === 'high') s -= 5
  return clamp(s, 0, 100)
}

function profileSignal(pieces: Piece[], ctx: Ctx): { score: number; availability: number } | null {
  if (!ctx.cp) return null
  const s = weightedMean(pieces.map((p) => [profileColorFit(p.item.colors[0], ctx.cp), PROFILE_SLOT_WEIGHT[p.slot]]))
  return s === null ? null : { score: s, availability: clamp(ctx.cp.strength / 0.8, 0, 1) }
}

export function styleSignal(pieces: Piece[]): number | null {
  const styles = pieces.filter((p) => p.slot !== 'accessory').map((p) => p.item.style).filter((s): s is string => !!s)
  if (styles.length < 2) return null
  const unique = [...new Set(styles)].sort()
  if (unique.length === 1) return 95
  if (STYLE_FAMILIES.some((f) => unique.every((s) => f.has(s)))) return 82
  let pairs = 0, ok = 0
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs++
      if (STYLE_FAMILIES.some((f) => f.has(unique[i]) && f.has(unique[j]))) ok++
    }
  }
  return 45 + 30 * (ok / pairs)
}

function layeringSignal(pieces: Piece[], ctx: Ctx): { score: number; availability: number } {
  const outer = pieces.find((p) => p.slot === 'outerwear')
  const dress = pieces.some((p) => p.slot === 'dress')
  const dressy = !!ctx.occasion && DRESSY_OCCASIONS.has(ctx.occasion)
  const wx = ctx.wx
  if (!wx?.band) return { score: outer ? (dressy ? 80 : 70) : 75, availability: 0.5 }
  let s: number
  switch (wx.band) {
    case 'very_cold':
    case 'cold':
      s = outer ? 95 : ctx.outerwearAvailable ? 40 : 55
      if (!outer && dress) s -= 10
      break
    case 'mild':
      s = outer ? (warmthOf(outer.item) <= 2 ? 88 : 70) : 80
      break
    case 'warm':
      s = outer ? (dressy && outer.item.subcategory === 'blazer' ? 85 : 62) : 90
      break
    case 'hot':
      s = outer ? (dressy ? 60 : 45) : 95
      break
  }
  const exposed = wx.wet === 'likely' || wx.wind === 'windy' || wx.wind === 'strong'
  if (exposed) s += outer && outer.item.subcategory && PROTECTIVE_OUTERWEAR.has(outer.item.subcategory) ? 8 : -8
  return { score: clamp(s, 0, 100), availability: 1 }
}

function preferenceSignal(pieces: Piece[], ctx: Ctx): number | null {
  return weightedMean(pieces.map((p) => [preferenceFit(p.item, ctx.profile), SLOT_WEIGHT[p.slot] || 0.3]))
}

function feedbackSignal(pieces: Piece[], mainKey: string, ctx: Ctx): number | null {
  const fb = ctx.feedback
  if (!fb) return null
  if (fb.rejectedOutfitKeys?.includes(mainKey)) return 5
  const items = pieces.map((p) => itemFeedback(p.item, fb)).filter((v): v is number => v !== null)
  if (items.length === 0) return (fb.rejectedOutfitKeys?.length ?? 0) > 0 ? 70 : null
  return items.reduce((a, b) => a + b, 0) / items.length
}

// ─── Reasons ────────────────────────────────────────────────────────────────

/** Reason codes (internal, stable) → user-facing Uzbek labels, in display order. */
export const REASON_LABELS: ReadonlyArray<[string, string]> = [
  ['weather', 'Ob-havoga mos'],
  ['warm_layers', 'Issiq qatlamli'],
  ['rain_ready', 'Yomg‘irga tayyor'],
  ['snow_ready', 'Qorga mos poyabzal'],
  ['wind_ready', 'Shamoldan himoya'],
  ['occasion', 'Tadbirga mos'],
  ['color_harmony', 'Ranglar uyg‘un'],
  ['neutral_balance', 'Neytral asos'],
  ['color_profile', 'Rang profilingizga mos'],
  ['style_match', 'Uslub bir xil'],
  ['preference', 'Didingizga mos'],
]

function reasonsOf(pieces: Piece[], signals: Partial<Record<SignalName, number>>, ctx: Ctx): string[] {
  const has = (slot: Slot, set?: Set<string>) => pieces.some((p) => p.slot === slot && (!set || (p.item.subcategory && set.has(p.item.subcategory))))
  const codes = new Set<string>()
  if ((signals.weather ?? 0) >= 80) codes.add('weather')
  if ((ctx.wx?.band === 'cold' || ctx.wx?.band === 'very_cold') && has('outerwear')) codes.add('warm_layers')
  if (!ctx.wx?.snow && (ctx.wx?.wet === 'likely' || ctx.wx?.wet === 'possible') && has('outerwear', PROTECTIVE_OUTERWEAR) && has('footwear', WET_FOOTWEAR)) codes.add('rain_ready')
  if (ctx.wx?.snow && has('footwear', SNOW_FOOTWEAR)) codes.add('snow_ready')
  if ((ctx.wx?.wind === 'windy' || ctx.wx?.wind === 'strong') && has('outerwear', PROTECTIVE_OUTERWEAR)) codes.add('wind_ready')
  if ((signals.occasion ?? 0) >= 80) codes.add('occasion')
  if ((signals.color ?? 0) >= 80) codes.add('color_harmony')
  if (pieces.some((p) => p.slot !== 'accessory' && getColorMeta(p.item.colors[0] ?? '')?.isNeutral) && (signals.color ?? 0) >= 70) codes.add('neutral_balance')
  if ((signals.profile ?? 0) >= 80) codes.add('color_profile')
  if ((signals.style ?? 0) >= 80) codes.add('style_match')
  if ((signals.preference ?? 0) >= 80) codes.add('preference')
  return REASON_LABELS.map(([c]) => c).filter((c) => codes.has(c))
}

export const reasonLabel = (code: string) => REASON_LABELS.find(([c]) => c === code)?.[1] ?? null

// ─── Keys, ordering, seed ───────────────────────────────────────────────────

const SLOT_KEY_ORDER: Slot[] = ['top', 'bottom', 'dress', 'outerwear', 'footwear']

/** Canonical key: one id per main slot, accessories sorted. Two outfits are the same iff their keys are equal. */
export function outfitKey(pieces: Array<{ item: { id: string }; slot: Slot }>): string {
  const main = SLOT_KEY_ORDER.map((s) => `${s[0]}:${pieces.find((p) => p.slot === s)?.item.id ?? '-'}`)
  const acc = pieces.filter((p) => p.slot === 'accessory').map((p) => p.item.id).sort()
  return `${main.join('|')}|a:${acc.join(',')}`
}

/** Collision-resistant id for a canonical key. */
export const keyId = (key: string) => `o_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`

/** FNV-1a (32 bit): only maps a client seed onto a window; never used for identity. */
export function seedHash(seed: number): number {
  let h = 0x811c9dc5
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Stable order: score, then weather, occasion and colour fit, then the canonical key. */
export function compareCandidates(a: OutfitCandidate, b: OutfitCandidate): number {
  return (
    b.rawScore - a.rawScore ||
    (b.signals.weather ?? -1) - (a.signals.weather ?? -1) ||
    (b.signals.occasion ?? -1) - (a.signals.occasion ?? -1) ||
    (b.signals.color ?? -1) - (a.signals.color ?? -1) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}

/**
 * Up to POOL_SIZE candidates from a sorted list, preferring variety (an item in
 * at most MAX_ITEM_REPEAT of them). Keeps the input order within each group.
 */
export function varietyPool(sorted: OutfitCandidate[], size = POOL_SIZE): OutfitCandidate[] {
  const pool: OutfitCandidate[] = []
  const skipped: OutfitCandidate[] = []
  const uses = new Map<string, number>()
  for (const c of sorted) {
    if (pool.length >= size) break
    if (c.items.every((i) => (uses.get(i.item.id) ?? 0) < MAX_ITEM_REPEAT)) {
      pool.push(c)
      for (const i of c.items) uses.set(i.item.id, (uses.get(i.item.id) ?? 0) + 1)
    } else skipped.push(c)
  }
  // Repeats only fill the remaining places, after every varied candidate.
  for (const c of skipped) if (pool.length < size) pool.push(c)
  return pool
}

/** No seed: the best N. A seed: a deterministic window of N from the pool (best first within it). */
export function selectWithSeed(pool: OutfitCandidate[], topN: number, seed: number | undefined): OutfitCandidate[] {
  if (seed === undefined || pool.length <= topN) return pool.slice(0, topN)
  const windows = Math.ceil(pool.length / topN)
  const start = (seedHash(seed) % windows) * topN
  const picked = pool.slice(start, start + topN)
  for (const c of pool) if (picked.length < topN && !picked.includes(c)) picked.push(c)
  return picked.sort((a, b) => pool.indexOf(a) - pool.indexOf(b))
}

// ─── Accessories (ranked separately; never required) ────────────────────────

export function accessoryScore(item: WardrobeItemSummary, main: Piece[], ctx: Ctx): number {
  const wx = ctx.wx
  const occ = ctx.occasion
  const cold = wx?.band === 'cold' || wx?.band === 'very_cold'
  const windy = wx?.wind === 'windy' || wx?.wind === 'strong'
  let s = 50
  switch (item.subcategory) {
    case 'scarf':
      s += cold || windy ? 35 : wx?.band === 'hot' || wx?.band === 'warm' ? -40 : 0
      break
    case 'hat':
      s += (wx?.band === 'hot' && wx.uvHigh) || cold ? 25 : 0
      break
    case 'sunglasses':
      s += wx?.uvHigh ? 30 : 0
      break
    case 'watch':
      s += occ && ['work', 'wedding', 'date'].includes(occ) ? 25 : 8
      break
    case 'belt':
      s += main.some((p) => p.slot === 'bottom') && occ && ['work', 'wedding'].includes(occ) ? 20 : 0
      break
    case 'clutch':
      s += occ === 'wedding' || occ === 'date' ? 30 : occ === 'work' || occ === 'travel' ? -20 : 0
      break
    case 'tote':
      s += occ === 'work' || occ === 'casual' ? 20 : occ === 'wedding' ? -20 : 0
      break
    case 'backpack':
      s += occ === 'travel' || occ === 'casual' ? 25 : occ === 'wedding' || occ === 'work' ? -40 : 0
      break
    case 'crossbody':
      s += occ && ['casual', 'date', 'travel'].includes(occ) ? 15 : 0
      break
  }
  const f = formalityFit(item, occ)
  if (f !== null) s += (f - 70) / 2
  const color = item.colors[0]
  const mainColors = main.map((p) => p.item.colors[0]).filter((c): c is string => !!c)
  if (color && mainColors.length) s += (Math.max(...mainColors.map((c) => scoreColorPair(color, c).score)) - 70) / 2
  const pref = preferenceFit(item, ctx.profile)
  if (pref !== null) s += (pref - 70) / 2
  return clamp(s, 0, 100)
}

function bestAccessory(candidates: WardrobeItemSummary[], main: Piece[], ctx: Ctx): WardrobeItemSummary | null {
  let best: { item: WardrobeItemSummary; s: number } | null = null
  for (const item of candidates) {
    const s = accessoryScore(item, main, ctx)
    if (s >= ACCESSORY_MIN_SCORE && (!best || s > best.s || (s === best.s && item.id < best.item.id))) best = { item, s }
  }
  return best?.item ?? null
}

// ─── Scoring one composition ────────────────────────────────────────────────

function scoreComposition(pieces: Piece[], ctx: Ctx): OutfitCandidate {
  const mainKey = outfitKey(pieces)
  const weather = weatherSignal(pieces, ctx)
  const occasion = occasionSignal(pieces, ctx)
  const color = colorSignal(pieces, ctx.occasion)
  const profile = profileSignal(pieces, ctx)
  const style = styleSignal(pieces)
  const layering = layeringSignal(pieces, ctx)
  const preference = preferenceSignal(pieces, ctx)
  const feedback = feedbackSignal(pieces, mainKey, ctx)
  const entries: Array<[SignalName, number | null, number]> = [
    ['weather', weather?.score ?? null, weather?.availability ?? 0],
    ['occasion', occasion?.score ?? null, occasion?.availability ?? 0],
    ['color', color, 1],
    ['profile', profile?.score ?? null, profile?.availability ?? 0],
    ['style', style, 1],
    ['layering', layering.score, layering.availability],
    ['preference', preference, 1],
    ['feedback', feedback, 1],
  ]
  const signals: Partial<Record<SignalName, number>> = {}
  let num = 0, den = 0
  for (const [name, value, availability] of entries) {
    if (value === null || availability <= 0) continue
    signals[name] = Math.round(value)
    num += WEIGHTS[name] * availability * value
    den += WEIGHTS[name] * availability
  }
  const rawScore = den ? num / den : 50
  const r = (v: number | null | undefined) => (v === null || v === undefined ? 50 : Math.round(v))
  const reasons = reasonsOf(pieces, signals, ctx)
  return {
    tempId: keyId(mainKey),
    key: mainKey,
    mainKey,
    items: pieces.map((p) => ({ item: p.item, slot: p.slot, role: legacyRole(p.slot) })),
    score: Math.round(rawScore),
    rawScore,
    signals,
    factors: {
      weather: r(weather?.score),
      color: r(color),
      occasion: r(occasion?.score),
      style: r(style),
      season: r(weather?.season),
      balance: r(layering.score),
      preference: r(preference),
      feedback: r(feedback),
    },
    reasons,
    reasonLabels: reasons.map((c) => reasonLabel(c)!),
    contrastLevel: contrastLevel(pieces.filter((p) => p.slot !== 'accessory').map((p) => p.item.colors)),
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function generateOutfitResult(input: GenerateInput): GenerateResult {
  const wx = weatherContext(input.weather)
  // One entry per id, in canonical order (input order never matters).
  const unique = [...new Map(input.wardrobe.map((i) => [i.id, i])).values()].sort(byId)
  if (unique.length === 0) return { outfits: [], problem: 'empty_wardrobe', evaluated: 0, weather: wx }

  const bySlot: Record<Slot, WardrobeItemSummary[]> = { top: [], bottom: [], dress: [], outerwear: [], footwear: [], accessory: [] }
  let excludedByWeather = 0
  for (const item of unique) {
    const slot = slotOf(item)
    if (!slot) continue
    if (weatherExcludes(item, slot, wx)) {
      excludedByWeather++
      continue
    }
    bySlot[slot].push(item)
  }
  // Occasion: drop discouraged items only where the slot keeps an alternative.
  for (const slot of Object.keys(bySlot) as Slot[]) {
    const kept = bySlot[slot].filter((i) => !occasionDiscourages(i, input.occasion))
    if (kept.length > 0) bySlot[slot] = kept
  }

  const ctx: Ctx = {
    wx,
    occasion: input.occasion,
    profile: input.profile,
    cp: profileContext(input.colorProfile),
    feedback: input.feedback,
    outerwearAvailable: bySlot.outerwear.length > 0,
  }

  const hasMain = (bySlot.top.length > 0 && bySlot.bottom.length > 0) || bySlot.dress.length > 0
  if (bySlot.footwear.length === 0 || !hasMain) {
    const rawFootwear = unique.some((i) => slotOf(i) === 'footwear')
    const rawMain = (unique.some((i) => slotOf(i) === 'top') && unique.some((i) => slotOf(i) === 'bottom')) || unique.some((i) => slotOf(i) === 'dress')
    const problem: GenerateProblem = !rawFootwear ? 'no_footwear' : !rawMain ? 'no_main_pieces' : excludedByWeather > 0 ? 'nothing_suitable' : 'no_main_pieces'
    return { outfits: [], problem, evaluated: 0, weather: wx }
  }

  // Deterministic pre-ranking per slot → bounded finalists.
  const finalists = {} as Record<Exclude<Slot, 'accessory'>, WardrobeItemSummary[]>
  for (const slot of Object.keys(SLOT_LIMITS) as Array<Exclude<Slot, 'accessory'>>) {
    finalists[slot] = bySlot[slot]
      .map((item) => ({ item, s: itemRank(item, slot, ctx) }))
      .sort((a, b) => b.s - a.s || byId(a.item, b.item))
      .slice(0, SLOT_LIMITS[slot])
      .map((x) => x.item)
  }

  const cold = wx?.band === 'cold' || wx?.band === 'very_cold'
  const outerOptions: Array<WardrobeItemSummary | null> = [null, ...finalists.outerwear]
  /** Layering rules (hard): very cold needs a layer when one exists; cold needs one over short sleeves or a dress. */
  const layeringAllowed = (base: WardrobeItemSummary, isDress: boolean, outer: WardrobeItemSummary | null, bottom: WardrobeItemSummary | null, shoes: WardrobeItemSummary) => {
    if (outer) return !exposedWithOuterwear(bottom, shoes)
    if (!ctx.outerwearAvailable) return true
    if (wx?.band === 'very_cold') return false
    if (cold && (isDress || isShortSleeved(base))) return false
    return true
  }

  const scored = new Map<string, OutfitCandidate>()
  let evaluated = 0
  const consider = (pieces: Piece[]) => {
    if (evaluated >= MAX_CANDIDATES) return
    evaluated++
    const c = scoreComposition(pieces, ctx)
    if (!scored.has(c.mainKey)) scored.set(c.mainKey, c)
  }
  for (const d of finalists.dress) {
    for (const f of finalists.footwear) {
      for (const o of outerOptions) {
        if (!layeringAllowed(d, true, o, null, f)) continue
        consider([{ item: d, slot: 'dress' }, ...(o ? [{ item: o, slot: 'outerwear' as Slot }] : []), { item: f, slot: 'footwear' }])
      }
    }
  }
  for (const t of finalists.top) {
    for (const b of finalists.bottom) {
      for (const f of finalists.footwear) {
        for (const o of outerOptions) {
          if (!layeringAllowed(t, false, o, b, f)) continue
          consider([{ item: t, slot: 'top' }, { item: b, slot: 'bottom' }, ...(o ? [{ item: o, slot: 'outerwear' as Slot }] : []), { item: f, slot: 'footwear' }])
        }
      }
    }
  }
  if (scored.size === 0) return { outfits: [], problem: 'nothing_suitable', evaluated, weather: wx }

  // A composition the user rejected in the last 30 days goes below every other one.
  const rejected = new Set(input.feedback?.rejectedOutfitKeys ?? [])
  const all = [...scored.values()].sort(compareCandidates)
  const sorted = [...all.filter((c) => !rejected.has(c.mainKey)), ...all.filter((c) => rejected.has(c.mainKey))]
  const topN = clamp(Math.floor(input.topN ?? 3), 1, MAX_TOP_N)
  const chosen = selectWithSeed(varietyPool(sorted), topN, input.seed)

  // Accessories: at most one accessory and one bag, only when they suit the outfit.
  const accessories = bySlot.accessory.filter((i) => i.category === 'accessory')
  const bags = bySlot.accessory.filter((i) => i.category === 'bag')
  const outfits = chosen.map((c) => {
    const main: Piece[] = c.items.map((i) => ({ item: i.item, slot: i.slot }))
    const extra = [bestAccessory(accessories, main, ctx), bestAccessory(bags, main, ctx)].filter((x): x is WardrobeItemSummary => !!x)
    if (extra.length === 0) return c
    const items = [...c.items, ...extra.map((item) => ({ item, slot: 'accessory' as Slot, role: 'accessory' as LegacyRole }))]
    const key = outfitKey(items)
    return { ...c, items, key, tempId: keyId(key) }
  })
  return { outfits, problem: null, evaluated, weather: wx }
}

/** Compatibility entry point: the outfits only. */
export function generateOutfits(input: GenerateInput): OutfitCandidate[] {
  return generateOutfitResult(input).outfits
}

// ─── Composition validation (shared with saving) ────────────────────────────

export type CompositionError =
  | 'duplicate_item'
  | 'unknown_category'
  | 'missing_footwear'
  | 'multiple_footwear'
  | 'missing_main'
  | 'dress_with_top_or_bottom'
  | 'multiple_primary'
  | 'too_many_accessories'

/** Validates a set of items as one outfit (by category, not by the client's role labels). */
export function validateComposition(items: Array<{ id: string; category: string }>): CompositionError | null {
  if (new Set(items.map((i) => i.id)).size !== items.length) return 'duplicate_item'
  const slots = items.map((i) => CATEGORY_SLOT[i.category])
  if (slots.some((s) => !s)) return 'unknown_category'
  const count = (s: Slot) => slots.filter((x) => x === s).length
  if (count('footwear') === 0) return 'missing_footwear'
  if (count('footwear') > 1) return 'multiple_footwear'
  if (count('dress') > 0 && (count('top') > 0 || count('bottom') > 0)) return 'dress_with_top_or_bottom'
  if (count('dress') > 1 || count('top') > 1 || count('bottom') > 1 || count('outerwear') > 1) return 'multiple_primary'
  if (count('dress') === 0 && (count('top') === 0 || count('bottom') === 0)) return 'missing_main'
  const accessories = items.filter((i) => i.category === 'accessory').length
  const bags = items.filter((i) => i.category === 'bag').length
  if (accessories > 2 || bags > 1) return 'too_many_accessories'
  return null
}

/** Role labels a saved item may carry for its slot (legacy roles first). */
export const ROLES_FOR_SLOT: Record<Slot, readonly string[]> = {
  top: ['top'],
  bottom: ['bottom'],
  dress: ['top', 'dress'],
  outerwear: ['top', 'outerwear'],
  footwear: ['shoes', 'footwear'],
  accessory: ['accessory'],
}
export const SAVE_ROLES = ['top', 'bottom', 'shoes', 'accessory', 'dress', 'outerwear', 'footwear'] as const

