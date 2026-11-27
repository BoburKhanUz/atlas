/**
 * The outfit engine's tables as the Go service embeds them
 * (apps/api/internal/engine/tables.json): every threshold, weight, limit and
 * word list of src/lib/ai/outfit-config.ts, the seasonal palettes, the reason
 * labels, and the texts and names the deterministic explanation and the
 * outfit routes use. The rules themselves are ported by hand and held to
 * this code by golden vectors (scripts/golden-engine.ts). Shared by
 * scripts/engine-copy.ts and engine-copy.test.ts.
 */
import * as config from '@/lib/ai/outfit-config'
import { SEASONAL_PALETTES } from '@/lib/ai/color-analysis'
import { REASON_LABELS, ROLES_FOR_SLOT, SAVE_ROLES } from '@/lib/ai/outfit-engine'
import { BAND_LABEL, OCCASION_PHRASE } from '@/lib/ai/outfit-intelligence'
import { APPROVED_CATEGORY_NAMES, APPROVED_COLOR_NAMES, APPROVED_SUBCATEGORY_NAMES } from '@/lib/ai/stylist'
import { COMPOSITION_MESSAGES, PROBLEM_MESSAGES } from '@/lib/outfits/messages'

const list = (set: ReadonlySet<string>) => [...set]

export function engineCopy(): string {
  return (
    JSON.stringify(
      {
        version: config.OUTFIT_ENGINE_VERSION,
        categorySlot: config.CATEGORY_SLOT,
        // The first band has no lower bound (-Infinity): null here.
        temperatureBands: config.TEMPERATURE_BANDS.map(({ band, from }) => ({ band, from: Number.isFinite(from) ? from : null })),
        targetWarmth: config.TARGET_WARMTH,
        rainLikelyPct: config.RAIN_LIKELY_PCT,
        rainPossiblePct: config.RAIN_POSSIBLE_PCT,
        windyKmh: config.WINDY_KMH,
        strongWindKmh: config.STRONG_WIND_KMH,
        highUv: config.HIGH_UV,
        subcategoryWarmth: config.SUBCATEGORY_WARMTH,
        categoryWarmth: config.CATEGORY_WARMTH,
        materialWarmth: config.MATERIAL_WARMTH,
        sleeveWarmth: config.SLEEVE_WARMTH,
        protectiveOuterwear: list(config.PROTECTIVE_OUTERWEAR),
        wetFootwear: list(config.WET_FOOTWEAR),
        snowFootwear: list(config.SNOW_FOOTWEAR),
        wetSensitiveMaterials: list(config.WET_SENSITIVE_MATERIALS),
        formalityOrder: config.FORMALITY_ORDER,
        occasionFormality: config.OCCASION_FORMALITY,
        dressyOccasions: list(config.DRESSY_OCCASIONS),
        offOccasionStyles: Object.fromEntries(Object.entries(config.OFF_OCCASION_STYLES).map(([occasion, styles]) => [occasion, list(styles)])),
        styleFormality: config.STYLE_FORMALITY,
        subcategoryFormality: config.SUBCATEGORY_FORMALITY,
        styleFamilies: config.STYLE_FAMILIES.map(list),
        weights: config.WEIGHTS,
        slotWeight: config.SLOT_WEIGHT,
        slotArea: config.SLOT_AREA,
        profileSlotWeight: config.PROFILE_SLOT_WEIGHT,
        profileMinConfidence: config.PROFILE_MIN_CONFIDENCE,
        legacyProfileConfidence: config.LEGACY_PROFILE_CONFIDENCE,
        undertoneMinConfidence: config.UNDERTONE_MIN_CONFIDENCE,
        slotLimits: config.SLOT_LIMITS,
        maxCandidates: config.MAX_CANDIDATES,
        poolSize: config.POOL_SIZE,
        maxItemRepeat: config.MAX_ITEM_REPEAT,
        maxTopN: config.MAX_TOP_N,
        accessoryMinScore: config.ACCESSORY_MIN_SCORE,
        reasonLabels: REASON_LABELS.map(([code, label]) => ({ code, label })),
        rolesForSlot: ROLES_FOR_SLOT,
        saveRoles: SAVE_ROLES,
        seasonalPalettes: SEASONAL_PALETTES,
        bandLabel: BAND_LABEL,
        occasionPhrase: OCCASION_PHRASE,
        approvedColorNames: APPROVED_COLOR_NAMES,
        approvedSubcategoryNames: APPROVED_SUBCATEGORY_NAMES,
        approvedCategoryNames: APPROVED_CATEGORY_NAMES,
        problemMessages: PROBLEM_MESSAGES,
        compositionMessages: COMPOSITION_MESSAGES,
      },
      null,
      1,
    ) + '\n'
  )
}
