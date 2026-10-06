/**
 * Outfit engine configuration (Phase 4.4). Every threshold, weight and limit
 * of the deterministic outfit engine lives here, so they can be reviewed and
 * tuned in one place (docs/ai/outfit-engine.md). Values are first estimates;
 * they are not calibrated on user data.
 */

/** Bump when rules or weights change in a way that changes rankings. */
export const OUTFIT_ENGINE_VERSION = 'outfit-engine-v2'

// ─── Semantic slots ─────────────────────────────────────────────────────────

/** The role an item plays in an outfit (catalog category → slot). */
export type Slot = 'top' | 'bottom' | 'dress' | 'outerwear' | 'footwear' | 'accessory'

/** Catalog categories (src/lib/ai/catalog.ts) mapped to slots. */
export const CATEGORY_SLOT: Record<string, Slot> = {
  shirt: 'top',
  pants: 'bottom',
  dress: 'dress',
  outerwear: 'outerwear',
  shoes: 'footwear',
  bag: 'accessory',
  accessory: 'accessory',
}

// ─── Weather ────────────────────────────────────────────────────────────────

export type TemperatureBand = 'very_cold' | 'cold' | 'mild' | 'warm' | 'hot'

/** Lower bounds (°C, felt temperature) of each band, coldest first. */
export const TEMPERATURE_BANDS: ReadonlyArray<{ band: TemperatureBand; from: number }> = [
  { band: 'very_cold', from: -Infinity },
  { band: 'cold', from: 3 },
  { band: 'mild', from: 12 },
  { band: 'warm', from: 19 },
  { band: 'hot', from: 27 },
]

/** Total outfit warmth (sum of item warmth, see ITEM_WARMTH) that suits each band. */
export const TARGET_WARMTH: Record<TemperatureBand, { min: number; max: number }> = {
  very_cold: { min: 7, max: 99 },
  cold: { min: 5, max: 8 },
  mild: { min: 3, max: 6 },
  warm: { min: 2, max: 4 },
  hot: { min: 0, max: 3 },
}

/** Precipitation probability (%) at which rain is likely / possible. */
export const RAIN_LIKELY_PCT = 60
export const RAIN_POSSIBLE_PCT = 30
/** Wind speed (km/h) that is windy / strong. */
export const WINDY_KMH = 30
export const STRONG_WIND_KMH = 50
/** UV index at which sunglasses / a hat are useful. */
export const HIGH_UV = 6

// ─── Item warmth (0 = very light … 3 = very warm) ───────────────────────────

/** By subcategory; categories without a subcategory use CATEGORY_WARMTH. */
export const SUBCATEGORY_WARMTH: Record<string, number> = {
  coat: 3,
  jacket: 2,
  blazer: 1,
  windbreaker: 1,
  knit: 2,
  oxford_shirt: 1,
  blouse: 1,
  polo: 1,
  tshirt: 0,
  jeans: 1,
  chinos: 1,
  trousers: 1,
  shorts: 0,
  casual_dress: 1,
  evening_dress: 1,
  midi_dress: 1,
  boots: 2,
  sneakers: 1,
  loafers: 1,
  oxford_shoes: 1,
  sandals: 0,
}
export const CATEGORY_WARMTH: Record<string, number> = { shirt: 1, pants: 1, dress: 1, outerwear: 2, shoes: 1 }
/** Material adjustments to warmth. */
export const MATERIAL_WARMTH: Record<string, number> = { wool: 1, cashmere: 1, knit: 1, linen: -1, silk: -1 }
/** Sleeve length adjustments for tops and dresses. */
export const SLEEVE_WARMTH: Record<string, number> = { long: 0, three_quarter: 0, short: -1, sleeveless: -1 }

/** Outerwear that protects against rain / wind. */
export const PROTECTIVE_OUTERWEAR = new Set(['coat', 'jacket', 'windbreaker'])
/** Footwear that suits rain / snow. */
export const WET_FOOTWEAR = new Set(['boots', 'sneakers'])
export const SNOW_FOOTWEAR = new Set(['boots'])
/** Materials that wet weather damages (soft penalty). */
export const WET_SENSITIVE_MATERIALS = new Set(['suede', 'silk', 'linen'])

// ─── Occasion and formality ─────────────────────────────────────────────────

export const FORMALITY_ORDER = ['casual', 'smart_casual', 'formal', 'black_tie'] as const

/** Formalities that suit each occasion (the occasion catalog is unchanged). */
export const OCCASION_FORMALITY: Record<string, readonly string[]> = {
  work: ['smart_casual', 'formal'],
  wedding: ['formal', 'black_tie', 'smart_casual'],
  date: ['smart_casual', 'casual', 'formal'],
  travel: ['casual', 'smart_casual'],
  casual: ['casual', 'smart_casual'],
  other: ['casual', 'smart_casual', 'formal'],
}

/** Occasions where clearly casual items are excluded when better alternatives exist. */
export const DRESSY_OCCASIONS = new Set(['work', 'wedding'])
/** Styles that are never right for a dressy occasion (soft-excluded when alternatives exist). */
export const OFF_OCCASION_STYLES: Record<string, ReadonlySet<string>> = {
  work: new Set(['sporty', 'streetwear']),
  wedding: new Set(['sporty', 'streetwear']),
}

/** When an item has no formality, infer one from its style or footwear type. */
export const STYLE_FORMALITY: Record<string, string> = {
  formal: 'formal',
  classic: 'smart_casual',
  preppy: 'smart_casual',
  minimal: 'smart_casual',
  smart_casual: 'smart_casual',
  casual: 'casual',
  streetwear: 'casual',
  sporty: 'casual',
  bohemian: 'casual',
}
export const SUBCATEGORY_FORMALITY: Record<string, string> = {
  oxford_shoes: 'formal',
  loafers: 'smart_casual',
  boots: 'smart_casual',
  sneakers: 'casual',
  sandals: 'casual',
  blazer: 'formal',
  evening_dress: 'formal',
  tshirt: 'casual',
  shorts: 'casual',
}

/** Style families: styles in one family combine well. */
export const STYLE_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['casual', 'sporty', 'streetwear']),
  new Set(['smart_casual', 'minimal', 'classic', 'preppy']),
  new Set(['formal', 'classic', 'minimal']),
  new Set(['bohemian', 'casual']),
  // Smart casual is built on casual basics (an oxford shirt with jeans).
  new Set(['casual', 'smart_casual']),
]

// ─── Scoring weights (sum to 1; unavailable signals are left out and the rest renormalised) ──

export const WEIGHTS = {
  occasion: 0.22,
  weather: 0.22,
  color: 0.16,
  profile: 0.08,
  style: 0.1,
  layering: 0.1,
  preference: 0.08,
  feedback: 0.04,
} as const
export type SignalName = keyof typeof WEIGHTS

/** How much each slot counts in per-item averages (face-near pieces count more for colour). */
export const SLOT_WEIGHT: Record<Slot, number> = { top: 1, dress: 1.6, bottom: 1, outerwear: 0.9, footwear: 0.6, accessory: 0 }
/** Visual area of each slot, for colour balance. */
export const SLOT_AREA: Record<Slot, number> = { top: 0.3, bottom: 0.3, dress: 0.6, outerwear: 0.35, footwear: 0.1, accessory: 0.05 }
/** Colour-profile weight of each slot (near the face matters most). */
export const PROFILE_SLOT_WEIGHT: Record<Slot, number> = { top: 1, dress: 1, outerwear: 0.8, bottom: 0.3, footwear: 0, accessory: 0 }

// ─── Colour profile ─────────────────────────────────────────────────────────

/** A profile below this confidence is not used at all. */
export const PROFILE_MIN_CONFIDENCE = 0.25
/** Confidence assumed for profiles from before Phase 4.3 (no stored confidence). */
export const LEGACY_PROFILE_CONFIDENCE = 0.3
/** The undertone is used only at or above this confidence. */
export const UNDERTONE_MIN_CONFIDENCE = 0.4

// ─── Candidate generation ───────────────────────────────────────────────────

/** Finalists kept per slot after deterministic pre-ranking. */
export const SLOT_LIMITS: Record<Exclude<Slot, 'accessory'>, number> = { top: 12, bottom: 10, dress: 8, outerwear: 4, footwear: 6 }
/** Hard cap on scored combinations per request. */
export const MAX_CANDIDATES = 5000
/** Candidates kept for seeded selection and AI reranking. */
export const POOL_SIZE = 9
/** An item may appear in at most this many pooled candidates (variety). */
export const MAX_ITEM_REPEAT = 2
/** Maximum outfits returned (OutfitGenerateRequest.topN). */
export const MAX_TOP_N = 5
/** Accessories attached to one outfit: at most one accessory and one bag, each above this score. */
export const ACCESSORY_MIN_SCORE = 65

// ─── AI reranking and explanation ───────────────────────────────────────────

/** Per-call timeout and total budget of the optional AI step (the deterministic answer never waits longer). */
export const OUTFIT_AI_TIMEOUT_MS = 15_000
export const OUTFIT_AI_BUDGET_MS = 25_000
export const OUTFIT_EXPLANATION_MAX_CHARS = 600
