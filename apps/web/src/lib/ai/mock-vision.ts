/**
 * Mock clothing vision — Phase 3 placeholder for the real AI vision service
 * (which will live in a Python FastAPI service per spec section 5).
 *
 * This module is NOT a real ML model. It does TWO honest things:
 *   1. Extracts dominant colors from the uploaded image's pixels via sharp.
 *      Color is the one attribute we can determine deterministically from
 *      raw pixels — and we mark its confidence high.
 *   2. For other attributes (category, material, style, season, formality)
 *      we deterministically derive a plausible guess from the file name and
 *      dominant color, and we mark those confidences LOW so the UI never
 *      presents them as facts (spec rule: "AI must never pretend certainty
 *      when confidence is low").
 *
 * Every API response from this module is tagged with `mock: true` so the
 * frontend can label it "AI demo analizi" instead of presenting mock results
 * as production-grade vision.
 */

import sharp from 'sharp'
import { COLORS, CATEGORIES, SUBCATEGORIES, MATERIALS, STYLES, SEASONS, FORMALITIES, SLEEVE_LENGTHS, FITS, GENDERS, type CatalogEntry } from './catalog'

export interface ClothingDetection {
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
  confidence: Record<string, number>
  /** Always true for this mock module. Frontend can label appropriately. */
  mock: true
}

// ─── Color helpers ───────────────────────────────────────────────────────────

/** Euclidean distance in RGB space between an sampled pixel and a known color. */
function colorDistance(r: number, g: number, b: number, hex: string): number {
  const hr = parseInt(hex.slice(1, 3), 16)
  const hg = parseInt(hex.slice(3, 5), 16)
  const hb = parseInt(hex.slice(5, 7), 16)
  return Math.sqrt((r - hr) ** 2 + (g - hg) ** 2 + (b - hb) ** 2)
}

/** Map an RGB pixel to the closest catalog color id. */
function classifyPixel(r: number, g: number, b: number): string {
  let best = COLORS[0]
  let bestD = Infinity
  for (const c of COLORS) {
    const d = colorDistance(r, g, b, c.hex)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best.id
}

/**
 * Extract dominant colors from the image by:
 *   1. Resizing to 32×32 (deterministic, fast, sufficient).
 *   2. Quantizing each pixel to a known catalog color.
 *   3. Counting occurrences; returning top 1–2 (must clear 12% threshold).
 */
async function extractDominantColors(buffer: Buffer): Promise<{
  colors: string[]
  /** Average brightness of the image — used for material/season heuristics. */
  brightness: number
  /** Standard deviation of brightness — proxy for "is the image mostly one color?" */
  uniformity: number
}> {
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const counts: Record<string, number> = {}
  let totalBrightness = 0
  const brightnessSamples: number[] = []

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const id = classifyPixel(r, g, b)
    counts[id] = (counts[id] ?? 0) + 1

    // Perceived brightness using the standard ITU-R BT.601 formula
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b
    totalBrightness += brightness
    brightnessSamples.push(brightness)
  }

  const total = data.length / info.channels
  const sorted = Object.entries(counts)
    .map(([id, count]) => ({ id, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)

  const dominant: string[] = []
  for (const entry of sorted) {
    if (entry.ratio >= 0.12) dominant.push(entry.id)
    if (dominant.length >= 2) break
  }
  if (dominant.length === 0 && sorted[0]) dominant.push(sorted[0].id)

  const avgBrightness = totalBrightness / total
  const mean = avgBrightness
  const variance = brightnessSamples.reduce((s, b) => s + (b - mean) ** 2, 0) / brightnessSamples.length
  const stdDev = Math.sqrt(variance)
  // Uniformity: how "solid" the image is, scaled 0..1
  const uniformity = Math.max(0, 1 - stdDev / 80)

  return { colors: dominant, brightness: avgBrightness, uniformity }
}

// ─── Filename / context hints ───────────────────────────────────────────────
/** Try to extract a category hint from the uploaded file name. */
function categoryFromFilename(filename: string): string | null {
  const f = filename.toLowerCase()
  if (/(shirt|futbolka|koylak|blouse|polo|tee)/.test(f)) return 'shirt'
  if (/(jacket|kurtka|coat|palto|blazer|windbreaker|ustki)/.test(f)) return 'outerwear'
  if (/(pant|jean|shim|chino|trouser|short)/.test(f)) return 'pants'
  if (/(dress|koylak.*ayol|libos)/.test(f)) return 'dress'
  if (/(shoe|sneaker|boot|loafer|oyqi)/.test(f)) return 'shoes'
  if (/(bag|sumka|tote|backpack|clutch)/.test(f)) return 'bag'
  if (/(belt|scarf|hat|watch|sun|access)/.test(f)) return 'accessory'
  return null
}

function patternFromUniformity(uniformity: number): { id: string; confidence: number } {
  // Very uniform → solid. Less uniform → checked/striped guess with low conf.
  if (uniformity > 0.82) return { id: 'solid', confidence: 0.78 }
  if (uniformity > 0.62) return { id: 'color_block', confidence: 0.34 }
  return { id: 'striped', confidence: 0.22 }
}

// ─── Public API ──────────────────────────────────────────────────────────────
export interface AnalyzeInput {
  /** Original uploaded image buffer (any format sharp supports). */
  buffer: Buffer
  /** Original file name (used as a weak signal — never as ground truth). */
  filename: string
}

/**
 * Analyze a clothing image and return detected attributes.
 * This is a MOCK — it is deterministic and limited. The real implementation
 * will live in a Python FastAPI service per spec section 5.
 */
export async function analyzeClothing(input: AnalyzeInput): Promise<ClothingDetection> {
  const { colors, brightness, uniformity } = await extractDominantColors(input.buffer)

  // ── Category (low confidence, file-name heuristic) ────────────────────────
  const categoryHint = categoryFromFilename(input.filename)
  // If file name gives no hint, default to "shirt" (most common upload) but
  // explicitly mark confidence very low so user knows to verify.
  const category = categoryHint ?? 'shirt'
  const categoryConfidence = categoryHint ? 0.42 : 0.18

  // ── Subcategory (very low confidence) ───────────────────────────────────────
  const subs: CatalogEntry[] = SUBCATEGORIES[category] ?? []
  const subcategory = subs.length > 0 ? subs[0].id : null
  const subcategoryConfidence = 0.15

  // ── Color (high confidence — actual pixel analysis) ──────────────────────
  // Brightness check to refine: very bright (>200) and very dark (<50) pixels
  // are color-stable; mid-range samples may be tinted.
  const colorConfidence = brightness > 200 || brightness < 50 ? 0.94 : 0.86

  // ── Pattern ──────────────────────────────────────────────────────────────
  const patternResult = patternFromUniformity(uniformity)

  // ── Material (low confidence — derived from brightness + color) ──────────
  let material: string | null = null
  let materialConfidence = 0.18
  if (colors.includes('white') || colors.includes('cream') || colors.includes('ivory')) {
    material = 'cotton'; materialConfidence = 0.34
  } else if (colors.includes('blue') && patternResult.id === 'denim') {
    material = 'denim'; materialConfidence = 0.41
  } else if (brightness < 80) {
    material = 'wool'; materialConfidence = 0.22
  } else if (brightness > 200) {
    material = 'cotton'; materialConfidence = 0.31
  } else {
    material = 'cotton'; materialConfidence = 0.21
  }

  // ── Style (low confidence — derived from color palette) ──────────────────
  let style: string | null = 'smart_casual'
  let styleConfidence = 0.22
  const neutral = ['white', 'black', 'gray', 'beige', 'navy', 'cream', 'ivory', 'tan', 'khaki']
  const allNeutral = colors.every((c) => neutral.includes(c))
  if (allNeutral) {
    style = 'minimal'; styleConfidence = 0.38
  } else if (colors.some((c) => ['red', 'orange', 'pink', 'yellow', 'purple'].includes(c))) {
    style = 'casual'; styleConfidence = 0.27
  } else {
    style = 'smart_casual'; styleConfidence = 0.22
  }

  // ── Season (low-medium confidence — derived from brightness + material) ──
  let season: string[] = ['spring', 'summer', 'autumn']
  let seasonConfidence = 0.32
  if (material === 'wool' || material === 'cashmere') {
    season = ['autumn', 'winter']; seasonConfidence = 0.41
  } else if (brightness > 200) {
    season = ['spring', 'summer']; seasonConfidence = 0.36
  } else if (brightness < 80) {
    season = ['autumn', 'winter']; seasonConfidence = 0.29
  } else {
    season = ['spring', 'autumn']; seasonConfidence = 0.24
  }

  // ── Sleeve length (very low confidence — pure placeholder) ──────────────
  const sleeveLength = SLEEVE_LENGTHS[1].id // long
  const sleeveConfidence = 0.12

  // ── Fit (very low confidence) ─────────────────────────────────────────────
  const fit = FITS[1].id // regular
  const fitConfidence = 0.13

  // ── Formality (low confidence — derived from style) ─────────────────────
  let formality: string = 'smart_casual'
  let formalityConfidence = 0.28
  if (style === 'formal') {
    formality = 'formal'; formalityConfidence = 0.33
  } else if (style === 'casual') {
    formality = 'casual'; formalityConfidence = 0.31
  } else if (style === 'minimal') {
    formality = 'smart_casual'; formalityConfidence = 0.29
  }

  // ── Gender (low confidence — default unisex) ─────────────────────────────
  const gender = GENDERS[2].id // unisex
  const genderConfidence = 0.18

  return {
    category,
    subcategory,
    colors,
    pattern: patternResult.id,
    material,
    sleeveLength,
    fit,
    style,
    season,
    gender,
    formality,
    confidence: {
      category: categoryConfidence,
      subcategory: subcategoryConfidence,
      color: colorConfidence,
      pattern: patternResult.confidence,
      material: materialConfidence,
      style: styleConfidence,
      season: seasonConfidence,
      sleeveLength: sleeveConfidence,
      fit: fitConfidence,
      formality: formalityConfidence,
      gender: genderConfidence,
    },
    mock: true,
  }
}

// Re-export catalog for convenience
export { COLORS, CATEGORIES, MATERIALS, STYLES, SEASONS, FORMALITIES }
