/**
 * Color Analysis module — spec section 10.
 *
 * Analyzes a user-uploaded selfie to determine:
 *   - skin tone (light / medium / tan / deep)
 *   - undertone (warm / cool / neutral) via skin pixel RGB analysis
 *   - hair color (closest catalog match)
 *   - eye color (closest catalog match)
 *   - contrast level (low / medium / high) — derived from skin vs hair/eye
 *
 * From these, derives a seasonal palette:
 *   - Spring / Summer / Autumn / Winter
 *
 * Always presented as an AI recommendation, NOT a medical/scientific
 * diagnosis (spec section 10 last paragraph).
 *
 * Approach (real, deterministic, no ML model):
 *   1. Resize the selfie to 64x64 with sharp
 *   2. Detect skin pixels: YCbCr space, skin-region heuristic
 *   3. Average RGB of detected skin pixels → undertone classification
 *   4. Sample darker pixels near top (hair) + a small central region (eye)
 *   5. Map undertone + skin lightness + contrast → seasonal palette
 *   6. Return recommended / neutral / caution colors from the catalog
 */

import sharp from 'sharp'
import { InvalidImageError } from '@/lib/storage/provider'
import { COLORS } from './catalog'

export interface ColorAnalysisResult {
  skinTone: 'light' | 'medium' | 'tan' | 'deep'
  undertone: 'warm' | 'cool' | 'neutral'
  hairColor: string | null
  eyeColor: string | null
  contrastLevel: 'low' | 'medium' | 'high'
  season: 'spring' | 'summer' | 'autumn' | 'winter'
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
  /** Raw averages for the UI / debugging — never exposed to LLM directly. */
  analysis: {
    skinAvgRgb: { r: number; g: number; b: number }
    skinBrightness: number
    skinRegionCount: number
    hairAvgRgb: { r: number; g: number; b: number }
    eyeAvgRgb: { r: number; g: number; b: number }
    /** Confidence is high when many skin pixels were detected; low otherwise. */
    confidence: number
  }
}

// ─── Skin detection in YCbCr space ────────────────────────────────────────
// Standard skin heuristic: 77 ≤ Cb ≤ 127, 133 ≤ Cr ≤ 173
function isSkinPixel(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return y > 60 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173
}

function brightness(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// ─── Undertone classification ──────────────────────────────────────────────
// In RGB skin tones, a "warm" undertone tends to have:
//   R > G > B  with a small R-G gap and R-B gap > 30
// "Cool" undertone:
//   B is closer to G than to R (small G-B gap, R-G gap > 25)
// "Neutral" — in between
function classifyUndertone(r: number, g: number, b: number): 'warm' | 'cool' | 'neutral' {
  const rg = r - g
  const gb = g - b
  const rb = r - b

  // Cool undertone: relatively high G, low R-B contrast, sometimes slight blue tint
  if (gb < 18 && rg < 35 && rb > 25 && rb < 50) return 'cool'
  // Warm: clear R dominance over B (>=40), G noticeably above B
  if (rb >= 40 && rg >= 18 && gb >= 18) return 'warm'
  // Strong warm (very red-dominant)
  if (rb >= 50 && rg >= 25) return 'warm'
  // Strong cool (B close to R)
  if (rb < 25 && gb < 15) return 'cool'
  return 'neutral'
}

function classifySkinTone(b: number): 'light' | 'medium' | 'tan' | 'deep' {
  if (b > 200) return 'light'
  if (b > 160) return 'medium'
  if (b > 110) return 'tan'
  return 'deep'
}

function classifyContrast(
  skinBrightness: number,
  hairBrightness: number,
): 'low' | 'medium' | 'high' {
  const diff = Math.abs(skinBrightness - hairBrightness)
  if (diff > 90) return 'high'
  if (diff > 45) return 'medium'
  return 'low'
}

// ─── Seasonal palette derivation ──────────────────────────────────────────
// Standard 4-season color analysis combining undertone × value:
//   Spring = warm + light
//   Summer = cool + light
//   Autumn = warm + deep
//   Winter = cool + deep
function deriveSeason(
  undertone: 'warm' | 'cool' | 'neutral',
  skinTone: 'light' | 'medium' | 'tan' | 'deep',
): 'spring' | 'summer' | 'autumn' | 'winter' {
  const isLight = skinTone === 'light' || skinTone === 'medium'
  if (undertone === 'warm') {
    return isLight ? 'spring' : 'autumn'
  }
  if (undertone === 'cool') {
    return isLight ? 'summer' : 'winter'
  }
  // Neutral — derive from skin tone alone (slight bias to warm side)
  return isLight ? 'spring' : 'autumn'
}

// ─── Color recommendations per season ──────────────────────────────────────
// Curated lists from the COLORS catalog (only ids that exist in catalog.ts).
// Spec section 10 result format: recommended / neutral / caution.
const SEASONAL_PALETTES: Record<
  'spring' | 'summer' | 'autumn' | 'winter',
  { recommended: string[]; neutral: string[]; caution: string[] }
> = {
  spring: {
    recommended: ['cream', 'light_blue', 'khaki', 'mustard', 'tan', 'beige', 'olive', 'orange'],
    neutral: ['cream', 'beige', 'tan', 'ivory'],
    caution: ['black', 'navy', 'burgundy', 'purple'],
  },
  summer: {
    recommended: ['white', 'light_blue', 'pink', 'gray', 'navy', 'cream', 'ivory', 'blue'],
    neutral: ['gray', 'cream', 'ivory', 'white'],
    caution: ['orange', 'mustard', 'rust', 'olive'],
  },
  autumn: {
    recommended: ['beige', 'brown', 'olive', 'mustard', 'rust', 'burgundy', 'tan', 'khaki'],
    neutral: ['beige', 'tan', 'brown', 'cream'],
    caution: ['white', 'light_blue', 'pink', 'gray'],
  },
  winter: {
    recommended: ['white', 'black', 'navy', 'burgundy', 'red', 'teal', 'gray', 'blue'],
    neutral: ['black', 'gray', 'navy', 'white'],
    caution: ['beige', 'cream', 'tan', 'mustard'],
  },
}

// Fix the catalog id names — some need normalization to match our catalog.ts
function normalizeColorIds(ids: string[]): string[] {
  // Filter to only ids that exist in the catalog
  return ids.filter((id) => COLORS.some((c) => c.id === id))
}

// ─── Public API ────────────────────────────────────────────────────────────
export interface AnalyzeSelfieInput {
  buffer: Buffer
}

const MAX_INPUT_PIXELS = 40_000_000 // ~40 MP — guards against decompression bombs
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif'])

export async function analyzeSelfie(input: AnalyzeSelfieInput): Promise<ColorAnalysisResult> {
  // 0. Decode-check the real bytes: cap pixel count (decompression bombs) and
  //    only accept the formats the upload route advertises.
  const meta = await sharp(input.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => {
      throw new InvalidImageError('Not a decodable image')
    })
  if (!ALLOWED_FORMATS.has(meta.format ?? '')) {
    throw new InvalidImageError(`Unsupported image format: ${meta.format ?? 'unknown'}`)
  }

  // 1. Resize + get raw pixels
  const { data, info } = await sharp(input.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(128, 128, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height

  // 2. Detect skin pixels + accumulate average
  let skinR = 0, skinG = 0, skinB = 0, skinCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * info.channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (isSkinPixel(r, g, b)) {
        skinR += r
        skinG += g
        skinB += b
        skinCount += 1
      }
    }
  }

  if (skinCount === 0) {
    // No skin detected — return a neutral default with low confidence
    return {
      skinTone: 'medium',
      undertone: 'neutral',
      hairColor: null,
      eyeColor: null,
      contrastLevel: 'medium',
      season: 'autumn',
      recommendedColors: normalizeColorIds(SEASONAL_PALETTES.autumn.recommended),
      neutralColors: normalizeColorIds(SEASONAL_PALETTES.autumn.neutral),
      cautionColors: normalizeColorIds(SEASONAL_PALETTES.autumn.caution),
      analysis: {
        skinAvgRgb: { r: 0, g: 0, b: 0 },
        skinBrightness: 0,
        skinRegionCount: 0,
        hairAvgRgb: { r: 0, g: 0, b: 0 },
        eyeAvgRgb: { r: 0, g: 0, b: 0 },
        confidence: 0.1,
      },
    }
  }

  const avgSkinR = Math.round(skinR / skinCount)
  const avgSkinG = Math.round(skinG / skinCount)
  const avgSkinB = Math.round(skinB / skinCount)
  const skinBrightness = brightness(avgSkinR, avgSkinG, avgSkinB)

  // 3. Hair detection — sample the TOP 20% of the image (above face), find
  //    the most common non-skin dark color
  let hairR = 0, hairG = 0, hairB = 0, hairCount = 0
  const hairRegionEnd = Math.floor(h * 0.20)
  for (let y = 0; y < hairRegionEnd; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * info.channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (!isSkinPixel(r, g, b)) {
        hairR += r
        hairG += g
        hairB += b
        hairCount += 1
      }
    }
  }
  const avgHair = hairCount > 0
    ? { r: Math.round(hairR / hairCount), g: Math.round(hairG / hairCount), b: Math.round(hairB / hairCount) }
    : { r: avgSkinR, g: avgSkinG, b: avgSkinB }
  const hairBrightness = brightness(avgHair.r, avgHair.g, avgHair.b)

  // 4. Eye region — sample a small box in the center
  //    The center of a face photo usually has the eyes around 40-50% from top
  let eyeR = 0, eyeG = 0, eyeB = 0, eyeCount = 0
  const eyeYStart = Math.floor(h * 0.40)
  const eyeYEnd = Math.floor(h * 0.55)
  const eyeXStart = Math.floor(w * 0.30)
  const eyeXEnd = Math.floor(w * 0.70)
  for (let y = eyeYStart; y < eyeYEnd; y++) {
    for (let x = eyeXStart; x < eyeXEnd; x++) {
      const i = (y * w + x) * info.channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (!isSkinPixel(r, g, b)) {
        eyeR += r
        eyeG += g
        eyeB += b
        eyeCount += 1
      }
    }
  }
  const avgEye = eyeCount > 0
    ? { r: Math.round(eyeR / eyeCount), g: Math.round(eyeG / eyeCount), b: Math.round(eyeB / eyeCount) }
    : { r: avgHair.r, g: avgHair.g, b: avgHair.b }

  // 5. Classify everything
  const undertone = classifyUndertone(avgSkinR, avgSkinG, avgSkinB)
  const skinTone = classifySkinTone(skinBrightness)
  const contrastLevel = classifyContrast(skinBrightness, hairBrightness)
  const season = deriveSeason(undertone, skinTone)

  // 6. Map hair + eye to nearest catalog colors
  const hairColor = nearestCatalogColor(avgHair.r, avgHair.g, avgHair.b)
  const eyeColor = nearestCatalogColor(avgEye.r, avgEye.g, avgEye.b)

  const palette = SEASONAL_PALETTES[season]

  return {
    skinTone,
    undertone,
    hairColor,
    eyeColor,
    contrastLevel,
    season,
    recommendedColors: normalizeColorIds(palette.recommended),
    neutralColors: normalizeColorIds(palette.neutral),
    cautionColors: normalizeColorIds(palette.caution),
    analysis: {
      skinAvgRgb: { r: avgSkinR, g: avgSkinG, b: avgSkinB },
      skinBrightness: Math.round(skinBrightness),
      skinRegionCount: skinCount,
      hairAvgRgb: avgHair,
      eyeAvgRgb: avgEye,
      confidence: Math.min(0.95, 0.4 + skinCount / 800),
    },
  }
}

function nearestCatalogColor(r: number, g: number, b: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const c of COLORS) {
    const hr = parseInt(c.hex.slice(1, 3), 16)
    const hg = parseInt(c.hex.slice(3, 5), 16)
    const hb = parseInt(c.hex.slice(5, 7), 16)
    const d = Math.sqrt((r - hr) ** 2 + (g - hg) ** 2 + (b - hb) ** 2)
    if (d < bestD) {
      bestD = d
      best = c.id
    }
  }
  return best
}
