/**
 * Deterministic cross-check of the model's PRIMARY colour against the pixels
 * of the prepared image. Pixels only validate: they never add, remove or
 * replace colours (backgrounds and lighting make them unreliable as a
 * source). A strong conflict only lowers the colour confidence, so the user
 * is asked to review it.
 *
 * Every threshold lives here and is meant to be tuned on the evaluation set
 * (docs/ai/vision-evaluation.md).
 */
import sharp from 'sharp'
import { COLORS } from './catalog'

/** Fraction of the image kept around the centre (the garment is usually there). */
export const CENTER_FRACTION = 0.6
/** Pixels sampled per side after cropping. */
const SAMPLE_SIDE = 48
/** Primary colour family covers at least this share of the centre: supported. */
export const SUPPORTED_SHARE = 0.15
/** Below this share the colour conflicts with the pixels. */
export const CONFLICT_SHARE = 0.05
/** Colour confidence cap when the evidence is weak (between the two shares). */
export const WEAK_SUPPORT_MAX_CONFIDENCE = 0.6
/** Colour confidence cap on conflict: below the clients' 0.40 "low" band, so it is reviewed. */
export const CONFLICT_MAX_CONFIDENCE = 0.35

/**
 * Colours a camera can plausibly report for a garment of the given catalog
 * colour (shades, shadows, highlights). Symmetric enough for a validator.
 */
export const COLOR_FAMILIES: Record<string, readonly string[]> = {
  white: ['white', 'cream', 'ivory', 'gray'],
  black: ['black', 'gray', 'navy'],
  gray: ['gray', 'white', 'black'],
  navy: ['navy', 'blue', 'black'],
  blue: ['blue', 'navy', 'light_blue', 'teal'],
  light_blue: ['light_blue', 'blue', 'white', 'gray'],
  beige: ['beige', 'tan', 'cream', 'khaki', 'ivory'],
  cream: ['cream', 'ivory', 'white', 'beige'],
  ivory: ['ivory', 'cream', 'white', 'beige'],
  tan: ['tan', 'beige', 'khaki', 'brown'],
  khaki: ['khaki', 'beige', 'tan', 'olive'],
  brown: ['brown', 'tan', 'rust', 'burgundy'],
  olive: ['olive', 'khaki', 'green'],
  green: ['green', 'olive', 'teal'],
  teal: ['teal', 'green', 'blue'],
  red: ['red', 'burgundy', 'rust', 'pink'],
  burgundy: ['burgundy', 'red', 'brown', 'purple'],
  pink: ['pink', 'red', 'purple'],
  orange: ['orange', 'rust', 'mustard'],
  yellow: ['yellow', 'mustard'],
  purple: ['purple', 'burgundy', 'pink'],
  rust: ['rust', 'orange', 'brown', 'red'],
  mustard: ['mustard', 'yellow', 'khaki'],
}

const PALETTE = COLORS.map((c) => ({
  id: c.id,
  rgb: [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) as [number, number, number],
}))

function nearestColor(r: number, g: number, b: number): string {
  let best = PALETTE[0].id
  let bestDist = Infinity
  for (const c of PALETTE) {
    const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2
    if (d < bestDist) {
      bestDist = d
      best = c.id
    }
  }
  return best
}

/** Share of the image centre per nearest catalog colour (sums to 1). */
export async function centerColorShares(image: Uint8Array): Promise<Map<string, number>> {
  const img = sharp(image)
  const { width = 0, height = 0 } = await img.metadata()
  const w = Math.max(1, Math.round(width * CENTER_FRACTION))
  const h = Math.max(1, Math.round(height * CENTER_FRACTION))
  const { data, info } = await sharp(image)
    .extract({ left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h })
    .resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const counts = new Map<string, number>()
  const pixels = info.width * info.height
  for (let i = 0; i < data.length; i += info.channels) {
    const id = nearestColor(data[i], data[i + 1], data[i + 2])
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return new Map([...counts].map(([id, n]) => [id, n / pixels]))
}

export type ColorVerdict = 'supported' | 'weak' | 'conflict' | 'no_color'

export interface ColorCheck {
  verdict: ColorVerdict
  /** Share of the centre covered by the primary colour's family. */
  support: number
  /** Cap for the colour confidence, or null to keep it. */
  confidenceCap: number | null
}

export function judgeColor(primary: string | undefined, shares: Map<string, number>): ColorCheck {
  if (!primary) return { verdict: 'no_color', support: 0, confidenceCap: null }
  const family = COLOR_FAMILIES[primary] ?? [primary]
  const support = family.reduce((sum, id) => sum + (shares.get(id) ?? 0), 0)
  if (support >= SUPPORTED_SHARE) return { verdict: 'supported', support, confidenceCap: null }
  if (support >= CONFLICT_SHARE) return { verdict: 'weak', support, confidenceCap: WEAK_SUPPORT_MAX_CONFIDENCE }
  return { verdict: 'conflict', support, confidenceCap: CONFLICT_MAX_CONFIDENCE }
}

/** Checks the model's primary colour against the prepared image. */
export async function crossCheckPrimaryColor(image: Uint8Array, colors: string[]): Promise<ColorCheck> {
  if (colors.length === 0) return judgeColor(undefined, new Map())
  return judgeColor(colors[0], await centerColorShares(image))
}
