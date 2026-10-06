/**
 * Color theory module — spec section 12.
 *
 * Provides:
 *   - Color family classification (warm / cool / neutral)
 *   - Color harmony scoring between two or more colors
 *     (monochromatic, analogous, complementary, triadic)
 *   - Contrast level (low / medium / high)
 *   - Occasion-specific color suitability
 *
 * All scores are 0-100. Higher = better.
 *
 * This is NOT a real colorimetry library — it's a heuristic-based scoring
 * system using HSL values from the catalog. It's deterministic, fast, and
 * "explainable" (returns a reason string alongside the score) so the
 * recommendation engine can surface WHY an outfit scores well.
 */

import { COLORS } from './catalog'

export type ColorTemperature = 'warm' | 'cool' | 'neutral'

// ─── Color metadata ─────────────────────────────────────────────────────────
// Derived from catalog hex values. Lazy-computed on first use.
export interface ColorMeta {
  id: string
  hex: string
  hue: number // 0-360
  saturation: number // 0-1
  lightness: number // 0-1
  temperature: ColorTemperature
  isNeutral: boolean
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60
        break
      case g:
        h = ((b - r) / d + 2) * 60
        break
      case b:
        h = ((r - g) / d + 4) * 60
        break
    }
  }
  return { h, s, l }
}

function classifyTemperature(hue: number, saturation: number): ColorTemperature {
  // Low-saturation colors are neutral regardless of hue
  if (saturation < 0.12) return 'neutral'
  // Red/orange/yellow (0-60), yellow-green (60-90) → warm
  if (hue >= 0 && hue < 90) return 'warm'
  // Green-cyan (90-180) → neutral-warm (borderline — treat as neutral)
  if (hue >= 90 && hue < 180) return 'cool'
  // Blue (180-260) → cool
  if (hue >= 180 && hue < 260) return 'cool'
  // Purple/magenta (260-360) → cool-warm blend → cool for scoring
  return 'cool'
}

let _cache: Map<string, ColorMeta> | null = null

export function getColorMeta(id: string): ColorMeta | null {
  if (!_cache) {
    _cache = new Map()
    for (const c of COLORS) {
      const { h, s, l } = hexToHsl(c.hex)
      _cache.set(c.id, {
        id: c.id,
        hex: c.hex,
        hue: Math.round(h),
        saturation: s,
        lightness: l,
        temperature: classifyTemperature(h, s),
        isNeutral: s < 0.12,
      })
    }
  }
  return _cache.get(id) ?? null
}

// ─── Pair scoring ───────────────────────────────────────────────────────────

/**
 * Score color harmony between two colors. Returns 0-100 + reason.
 *
 * Rules:
 *   - Same color (monochromatic): high harmony
 *   - Both neutral: high harmony (always works)
 *   - Warm+warm or cool+cool: high harmony (analogous temperature)
 *   - Warm+cool: lower harmony but still works for "intentional contrast"
 *   - Complementary (opposite hue): good if intentional, lower for everyday
 *   - Clashing saturated opposite hues: low
 */
export function scoreColorPair(aId: string, bId: string): { score: number; reason: string } {
  const a = getColorMeta(aId)
  const b = getColorMeta(bId)
  if (!a || !b) return { score: 50, reason: 'noma\'lum rang' }

  // Same color → monochromatic harmony
  if (a.id === b.id) {
    return { score: 92, reason: 'monoxromatik moslik' }
  }

  // Both neutral → universally safe
  if (a.isNeutral && b.isNeutral) {
    return { score: 90, reason: 'neytral palitra uyg\'unligi' }
  }

  // One neutral + one colored → neutral base highlights the color
  if (a.isNeutral !== b.isNeutral) {
    return { score: 86, reason: 'neytral asos rangni urg\'unlashtiradi' }
  }

  // Both colored — compute hue distance
  const hueDiff = Math.abs(a.hue - b.hue)
  const hueDistance = Math.min(hueDiff, 360 - hueDiff)
  const tempMatch = a.temperature === b.temperature

  // Analogous (≤30° hue distance): very harmonious
  if (hueDistance <= 30 && tempMatch) {
    return { score: 88, reason: 'ranglar bir-biriga yaqin (analog)' }
  }

  // Same temperature, mid-distance: good
  if (tempMatch && hueDistance <= 90) {
    return { score: 80, reason: 'bir xil haroratdagi ranglar' }
  }

  // Complementary (≈180°): bold but intentional
  if (hueDistance >= 150 && hueDistance <= 210) {
    // High saturation complementary = bold; low = sophisticated
    const avgSat = (a.saturation + b.saturation) / 2
    if (avgSat < 0.4) {
      return { score: 75, reason: 'muloyim qarama-qarshi rang' }
    }
    return { score: 58, reason: 'keskin qarama-qarshi rang (jasur tanlov)' }
  }

  // Different temperature, far hue — generally clashing
  if (!tempMatch && hueDistance > 90) {
    return { score: 42, reason: 'harorat jihatidan mos kelmaydi' }
  }

  // Default: acceptable but unremarkable
  return { score: 65, reason: 'mos keluvchi rang' }
}

/**
 * Score color harmony across a full outfit (top + bottom + shoes).
 * Average pairwise + small bonus for consistency.
 */
export function scoreOutfitColors(colorSets: string[][]): {
  score: number
  reasons: string[]
} {
  if (colorSets.length < 2) return { score: 70, reasons: ['yetarchi rang'] }

  const reasons: string[] = []
  let total = 0
  let count = 0

  for (let i = 0; i < colorSets.length; i++) {
    for (let j = i + 1; j < colorSets.length; j++) {
      // For each pair of items, take the best color pair across all combos
      // (e.g., top has [white, blue], bottom has [black] → best pair white+black)
      let best = 0
      let bestReason = ''
      for (const c1 of colorSets[i]) {
        for (const c2 of colorSets[j]) {
          const r = scoreColorPair(c1, c2)
          if (r.score > best) {
            best = r.score
            bestReason = r.reason
          }
        }
      }
      total += best
      count += 1
      if (best >= 80 && bestReason && !reasons.includes(bestReason)) {
        reasons.push(bestReason)
      }
    }
  }

  const avg = count > 0 ? total / count : 70
  return { score: Math.round(avg), reasons }
}

/**
 * Compute contrast level of an outfit — used for "formal vs casual" hints.
 */
export function contrastLevel(colorSets: string[][]): 'low' | 'medium' | 'high' {
  const lightnesses: number[] = []
  for (const set of colorSets) {
    for (const c of set) {
      const meta = getColorMeta(c)
      if (meta) lightnesses.push(meta.lightness)
    }
  }
  if (lightnesses.length < 2) return 'low'
  const max = Math.max(...lightnesses)
  const min = Math.min(...lightnesses)
  const diff = max - min
  if (diff > 0.6) return 'high'
  if (diff > 0.3) return 'medium'
  return 'low'
}

// ─── Occasion-specific color rules ──────────────────────────────────────────

export type Occasion = 'work' | 'wedding' | 'date' | 'travel' | 'casual' | 'other'

/**
 * Score how well the outfit's color palette suits a given occasion.
 * Spec section 16: Ish / To'y / Uchrashuv / Sayohat / Casual / Boshqa.
 */
export function scoreColorForOccasion(
  colorSets: string[][],
  occasion: Occasion,
): { score: number; reason: string | null } {
  const allColors = colorSets.flat()
  if (allColors.length === 0) return { score: 50, reason: null }

  const temperatures = allColors.map((id) => getColorMeta(id)?.temperature ?? 'neutral')
  const hasWarm = temperatures.includes('warm')
  const hasCool = temperatures.includes('cool')
  const allNeutral = temperatures.every((t) => t === 'neutral')
  const hasBright = allColors.some((id) => {
    const m = getColorMeta(id)
    return m && m.saturation > 0.5
  })

  switch (occasion) {
    case 'wedding':
      // Warm + elegant — soft + sophisticated
      if (allNeutral) return { score: 88, reason: 'neytral palitra to\'y uchun mos' }
      if (hasWarm && !hasBright) return { score: 90, reason: 'issiq ranglar to\'y uchun ideal' }
      if (hasBright) return { score: 45, reason: 'yorqin ranglar to\'yda tortinmaydi' }
      return { score: 70, reason: null }

    case 'work':
      // Neutral + minimal saturation → professional
      if (allNeutral) return { score: 92, reason: 'professional neytral palitra' }
      if (!hasBright) return { score: 80, reason: 'muloyim palitra ish uchun mos' }
      return { score: 50, reason: 'yorqin ranglar ishga ortiqcha' }

    case 'date':
      // Warmer + slightly bold is good
      if (hasWarm) return { score: 88, reason: 'issiq ranglar uchrashuvga mos' }
      if (allNeutral) return { score: 75, reason: 'neytral — ishonchli tanlov' }
      return { score: 65, reason: null }

    case 'travel':
      // Practical — neutral + dark colors hide wrinkles/stains
      if (allNeutral) return { score: 88, reason: 'neytral palitra sayohat uchun amaliy' }
      return { score: 70, reason: null }

    case 'casual':
      // Anything goes — slight preference for variety
      return { score: 80, reason: null }

    case 'other':
    default:
      return { score: 70, reason: null }
  }
}
