/**
 * Selfie colour analysis (Phase 4.3, `color-analysis-v2`) — spec section 10.
 *
 * Deterministic and in-process: no model, no provider, no network. The
 * selfie is decoded into memory, measured and dropped; nothing of the image
 * is returned or stored except the derived profile below. Same bytes + same
 * version → same result.
 *
 * Pipeline:
 *   1. Decode check (format, real dimensions, decompression-bomb cap).
 *   2. Analysis canvas: EXIF-rotated, fitted inside 320 px (no crop), raw RGB.
 *   3. Photo quality: darkness, overexposure, detail and blur → typed rejection.
 *   4. Skin: YCbCr/luma mask inside the central region; only grid cells that
 *      are mostly skin contribute (scattered skin-coloured background is
 *      ignored); shadows, highlights and colour outliers are trimmed; the
 *      representative colour is measured in CIELAB.
 *   5. Undertone from the skin hue angle, with an "unknown" band when the
 *      cells disagree or the evidence is weak.
 *   6. Hair from a band right above the skin region (unknown when the band is
 *      indistinguishable from the background); eyes only when two dark,
 *      symmetric regions are found where eyes should be (unknown otherwise).
 *   7. Season by distance to four prototypes over warmth, lightness, chroma
 *      and contrast; confidence from the margin, image quality, sample size
 *      and agreement between regions, with conservative caps.
 *
 * This is a styling heuristic, not a medical or scientific measurement, and
 * it has no face detection: thresholds are first estimates to calibrate on
 * consented test photos (docs/ai/color-profile.md).
 */
import sharp from 'sharp'
import { ImageDimensionsError, InvalidImageError, isHeifContainer, IMAGE_MAX_SIDE, IMAGE_MIN_SIDE, UnsupportedImageFormatError } from '@/lib/storage/provider'
import { COLORS } from './catalog'

export const COLOR_ANALYSIS_VERSION = 'color-analysis-v2'
/** Stored on profiles made before Phase 4.3. */
export const LEGACY_COLOR_ANALYSIS_VERSION = 'color-heuristic-v1'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Undertone = 'warm' | 'neutral_warm' | 'neutral' | 'neutral_cool' | 'cool' | 'unknown'
export type SkinTone = 'light' | 'medium' | 'tan' | 'deep'
export type ContrastLevel = 'low' | 'medium' | 'high'
export type QualityProblem = 'too_dark' | 'overexposed' | 'blurry' | 'low_detail' | 'background'

/** The photo can be decoded but is not good enough to analyse. */
export class PhotoQualityError extends Error {
  constructor(readonly reason: QualityProblem) {
    super(`photo quality: ${reason}`)
    this.name = 'PhotoQualityError'
  }
}

/** Not enough skin is visible in the photo to measure a colour. */
export class SkinNotVisibleError extends Error {
  constructor() {
    super('skin not visible')
    this.name = 'SkinNotVisibleError'
  }
}

// ─── Tunable thresholds (one place; calibrate on the evaluation set) ────────

export const CANVAS_MAX_SIDE = 320
const MAX_INPUT_PIXELS = 40_000_000
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

export const QUALITY = {
  /** Mean luma below this, or most pixels crushed to black → too dark. */
  minMeanLuma: 50,
  maxCrushedShare: 0.5,
  /** Mean luma above this, or too many clipped pixels → overexposed. */
  maxMeanLuma: 220,
  maxClippedShare: 0.3,
  /** Luma standard deviation below this → no usable detail (flat image). */
  minLumaStd: 12,
  /** Variance of the Laplacian (canvas scale) below this → blurry. */
  minSharpness: 12,
} as const

export const SKIN = {
  /** Minimum skin pixels and share of the central region. */
  minPixels: 600,
  minCentralShare: 0.06,
  /** A grid cell counts as a skin region when this share of it is skin. */
  cellShare: 0.35,
  minCells: 2,
  /** Skin-coloured pixels everywhere, edges included → cannot separate person from background. */
  backgroundShare: 0.6,
  /** Cells whose lightness (L*) differs more than this from the central cells are not this skin. */
  maxCellLightnessGap: 15,
} as const

/** Undertone class boundaries on the CIELAB hue angle of skin (degrees). */
export const UNDERTONE_BOUNDS = { cool: 41, neutralCool: 47, neutralWarm: 53, warm: 59 } as const

export const CONFIDENCE = {
  /** Never claim more than this for a heuristic from one photo. */
  max: 0.8,
  undertoneMax: 0.75,
  /** Below this the undertone is "unknown". */
  undertoneMin: 0.3,
  /** Below this the season is not given at all. */
  seasonMin: 0.3,
  /** Caps when a dimension is missing. */
  withoutUndertone: 0.45,
  withoutContrast: 0.65,
  hairMax: 0.7,
  hairMin: 0.3,
  eyeMax: 0.5,
} as const

// ─── Colour maths ───────────────────────────────────────────────────────────

export interface Lab {
  L: number
  a: number
  b: number
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

function lin(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB (0–255) → CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r), G = lin(g), B = lin(b)
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) }
}

export const chroma = (c: Lab) => Math.hypot(c.a, c.b)
export const hueAngle = (c: Lab) => ((Math.atan2(c.b, c.a) * 180) / Math.PI + 360) % 360
const deltaE = (p: Lab, q: Lab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)
const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

export function isSkinPixel(r: number, g: number, b: number): boolean {
  const y = luma(r, g, b)
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return y > 35 && y < 240 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > b
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
}
function std(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}
function median(values: number[]): number {
  return quantile([...values].sort((x, y) => x - y), 0.5)
}
function meanLab(px: Lab[]): Lab {
  return { L: mean(px.map((p) => p.L)), a: mean(px.map((p) => p.a)), b: mean(px.map((p) => p.b)) }
}

// ─── Canvas ─────────────────────────────────────────────────────────────────

export interface Canvas {
  width: number
  height: number
  /** RGB, 3 bytes per pixel. */
  data: Uint8Array
}

const px = (c: Canvas, x: number, y: number) => {
  const i = (y * c.width + x) * 3
  return [c.data[i], c.data[i + 1], c.data[i + 2]] as const
}

/** Decode-checks the bytes and returns the analysis canvas (the only pixels kept, in memory). */
export async function loadCanvas(buffer: Buffer): Promise<Canvas> {
  if (isHeifContainer(buffer)) throw new UnsupportedImageFormatError('HEIC/HEIF/AVIF is not accepted')
  const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => {
      throw new InvalidImageError('Not a decodable image')
    })
  if (!ACCEPTED_FORMATS.has(meta.format ?? '')) throw new UnsupportedImageFormatError(`Unsupported image format: ${meta.format ?? 'unknown'}`)
  const swap = (meta.orientation ?? 1) >= 5
  const width = (swap ? meta.height : meta.width) ?? 0
  const height = (swap ? meta.width : meta.height) ?? 0
  if (Math.min(width, height) < IMAGE_MIN_SIDE || Math.max(width, height) > IMAGE_MAX_SIDE) throw new ImageDimensionsError(`Image is ${width}×${height}`)
  const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(CANVAS_MAX_SIDE, CANVAS_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#808080' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new InvalidImageError('Not a decodable image')
    })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

// ─── Quality ────────────────────────────────────────────────────────────────

export interface QualityMetrics {
  meanLuma: number
  lumaStd: number
  crushedShare: number
  clippedShare: number
  sharpness: number
}

export function measureQuality(c: Canvas): QualityMetrics {
  const n = c.width * c.height
  const lum = new Float64Array(n)
  let sum = 0, crushed = 0, clipped = 0
  for (let i = 0; i < n; i++) {
    const l = luma(c.data[i * 3], c.data[i * 3 + 1], c.data[i * 3 + 2])
    lum[i] = l
    sum += l
    if (l <= 10) crushed++
    if (l >= 248) clipped++
  }
  const m = sum / n
  let sq = 0
  for (let i = 0; i < n; i++) sq += (lum[i] - m) ** 2
  // Variance of the 4-neighbour Laplacian over the interior.
  let lapSum = 0, lapSq = 0, count = 0
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const i = y * c.width + x
      const v = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - c.width] - lum[i + c.width]
      lapSum += v
      lapSq += v * v
      count++
    }
  }
  const lapMean = count ? lapSum / count : 0
  return {
    meanLuma: m,
    lumaStd: Math.sqrt(sq / n),
    crushedShare: crushed / n,
    clippedShare: clipped / n,
    sharpness: count ? lapSq / count - lapMean ** 2 : 0,
  }
}

/** Throws PhotoQualityError for the first problem found; returns a quality score in [0.6, 1]. */
export function assessQuality(q: QualityMetrics): number {
  if (q.meanLuma < QUALITY.minMeanLuma || q.crushedShare > QUALITY.maxCrushedShare) throw new PhotoQualityError('too_dark')
  if (q.meanLuma > QUALITY.maxMeanLuma || q.clippedShare > QUALITY.maxClippedShare) throw new PhotoQualityError('overexposed')
  if (q.lumaStd < QUALITY.minLumaStd) throw new PhotoQualityError('low_detail')
  if (q.sharpness < QUALITY.minSharpness) throw new PhotoQualityError('blurry')
  const margins = [
    clamp((q.meanLuma - QUALITY.minMeanLuma) / 40, 0, 1),
    clamp((QUALITY.maxMeanLuma - q.meanLuma) / 40, 0, 1),
    clamp((QUALITY.maxClippedShare - q.clippedShare) / 0.2, 0, 1),
    clamp((q.sharpness - QUALITY.minSharpness) / (QUALITY.minSharpness * 3), 0, 1),
  ]
  return 0.6 + 0.4 * Math.min(...margins)
}

// ─── Skin ───────────────────────────────────────────────────────────────────

export interface SkinRegion {
  /** Representative colour after outlier rejection. */
  lab: Lab
  luma: number
  pixels: number
  cells: number
  /** Agreement between the per-cell hue angles, 0–1. */
  agreement: number
  /** Bounding box of the skin cells (canvas pixels, inclusive). */
  box: { top: number; bottom: number; left: number; right: number }
}

const GRID = 4

export function measureSkin(c: Canvas): SkinRegion {
  const x0 = Math.floor(c.width * 0.15), x1 = Math.ceil(c.width * 0.85)
  const y0 = Math.floor(c.height * 0.1), y1 = Math.ceil(c.height * 0.9)
  const border = Math.max(2, Math.round(Math.min(c.width, c.height) * 0.08))
  let central = 0, centralSkin = 0, edge = 0, edgeSkin = 0
  const skin = new Uint8Array(c.width * c.height)
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const [r, g, b] = px(c, x, y)
      const s = isSkinPixel(r, g, b) ? 1 : 0
      skin[y * c.width + x] = s
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        central++
        centralSkin += s
      }
      if (x < border || x >= c.width - border || y < border || y >= c.height - border) {
        edge++
        edgeSkin += s
      }
    }
  }
  const centralShare = centralSkin / central
  if (edgeSkin / edge > SKIN.backgroundShare && centralShare > SKIN.backgroundShare) throw new PhotoQualityError('background')
  if (centralSkin < SKIN.minPixels || centralShare < SKIN.minCentralShare) throw new SkinNotVisibleError()

  // Only grid cells that are mostly skin are skin regions.
  const cellW = (x1 - x0) / GRID, cellH = (y1 - y0) / GRID
  const cells: Array<{ pixels: Lab[]; lumas: number[]; gx: number; gy: number }> = []
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const cx0 = Math.floor(x0 + gx * cellW), cx1 = Math.floor(x0 + (gx + 1) * cellW)
      const cy0 = Math.floor(y0 + gy * cellH), cy1 = Math.floor(y0 + (gy + 1) * cellH)
      const pixels: Lab[] = []
      const lumas: number[] = []
      let total = 0
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          total++
          if (!skin[y * c.width + x]) continue
          const [r, g, b] = px(c, x, y)
          pixels.push(rgbToLab(r, g, b))
          lumas.push(luma(r, g, b))
        }
      }
      if (total > 0 && pixels.length / total >= SKIN.cellShare) cells.push({ pixels, lumas, gx, gy })
    }
  }
  if (cells.length < SKIN.minCells) throw new SkinNotVisibleError()

  // Anchor on the cells nearest the centre (where a selfie's face is): cells
  // much lighter or darker than them are another surface that only passes the
  // skin colour test (dark-brown hair, a wooden wall), not this skin.
  const centre = (GRID - 1) / 2
  const byDistance = [...cells].sort((p, q) => Math.hypot(p.gx - centre, p.gy - centre) - Math.hypot(q.gx - centre, q.gy - centre))
  const cellL = (cell: (typeof cells)[number]) => median(cell.pixels.map((p) => p.L))
  const refL = median(byDistance.slice(0, Math.min(4, byDistance.length)).map(cellL))
  const anchored = cells.filter((cell) => Math.abs(cellL(cell) - refL) <= SKIN.maxCellLightnessGap)
  cells.length = 0
  cells.push(...anchored)
  if (cells.length < SKIN.minCells) throw new SkinNotVisibleError()

  // Outlier rejection: shadows and highlights by lightness, then colour outliers by distance to the median.
  const all = cells.flatMap((cell) => cell.pixels.map((p, i) => ({ p, l: cell.lumas[i], cell })))
  const sortedL = all.map((e) => e.p.L).sort((x, y) => x - y)
  const lo = quantile(sortedL, 0.1), hi = quantile(sortedL, 0.95)
  const lit = all.filter((e) => e.p.L >= lo && e.p.L <= hi)
  const ma = median(lit.map((e) => e.p.a)), mb = median(lit.map((e) => e.p.b))
  const dist = lit.map((e) => Math.abs(e.p.a - ma) + Math.abs(e.p.b - mb))
  const mad = Math.max(2, median(dist))
  const kept = lit.filter((_, i) => dist[i] <= 3 * mad)
  if (kept.length < SKIN.minPixels / 2) throw new SkinNotVisibleError()

  const lab = meanLab(kept.map((e) => e.p))
  // Agreement is judged before the colour-outlier step, which would otherwise
  // silently drop a whole disagreeing region; dropping many pixels is itself
  // a sign that the regions disagree.
  const perCell = cells
    .map((cell) => lit.filter((e) => e.cell === cell).map((e) => e.p))
    .filter((p) => p.length >= 20)
    .map((p) => hueAngle(meanLab(p)))
  const hueStd = perCell.length >= 2 ? std(perCell) : 10
  const keptShare = kept.length / Math.max(1, lit.length)
  const gys = cells.map((cl) => cl.gy), gxs = cells.map((cl) => cl.gx)
  return {
    lab,
    luma: mean(kept.map((e) => e.l)),
    pixels: kept.length,
    cells: cells.length,
    agreement: clamp(1 - hueStd / 10, 0, 1) * clamp((keptShare - 0.5) / 0.3, 0, 1),
    box: {
      top: Math.floor(y0 + Math.min(...gys) * cellH),
      bottom: Math.floor(y0 + (Math.max(...gys) + 1) * cellH) - 1,
      left: Math.floor(x0 + Math.min(...gxs) * cellW),
      right: Math.floor(x0 + (Math.max(...gxs) + 1) * cellW) - 1,
    },
  }
}

// ─── Undertone, skin tone ───────────────────────────────────────────────────

export function classifyUndertone(hue: number): Exclude<Undertone, 'unknown'> {
  const b = UNDERTONE_BOUNDS
  if (hue < b.cool) return 'cool'
  if (hue < b.neutralCool) return 'neutral_cool'
  if (hue < b.neutralWarm) return 'neutral'
  if (hue < b.warm) return 'neutral_warm'
  return 'warm'
}

/** Degrees to the nearest class boundary (how clearly the hue sits in its class). */
export function undertoneMargin(hue: number): number {
  return Math.min(...Object.values(UNDERTONE_BOUNDS).map((v) => Math.abs(hue - v)))
}

export function classifySkinTone(L: number): SkinTone {
  if (L >= 68) return 'light'
  if (L >= 57) return 'medium'
  if (L >= 45) return 'tan'
  return 'deep'
}

// ─── Hair and eyes (unknown unless the evidence is clear) ───────────────────

export interface FeatureColor {
  color: string | null
  lab: Lab | null
  confidence: number
}

const UNKNOWN: FeatureColor = { color: null, lab: null, confidence: 0 }

export function hairColorOf(c: Lab): string {
  const C = chroma(c), h = hueAngle(c)
  if (C < 12 && c.L >= 55) return 'gray'
  if (c.L < 22) return 'black'
  if (h < 50 && C >= 22 && c.L < 55) return 'rust'
  if (c.L < 40) return 'brown'
  if (c.L < 58) return 'tan'
  return 'beige'
}

/** Hair from the band right above the skin region; unknown when it looks like the background. */
export function measureHair(c: Canvas, skin: SkinRegion): FeatureColor {
  const faceTop = skin.box.top
  const bandH = Math.round(c.height * 0.15)
  const top = Math.max(0, faceTop - bandH)
  if (faceTop - top < 3) return UNKNOWN
  const left = Math.floor(c.width * 0.3), right = Math.ceil(c.width * 0.7)
  const band: Lab[] = []
  let total = 0
  for (let y = top; y < faceTop; y++) {
    for (let x = left; x < right; x++) {
      total++
      const [r, g, b] = px(c, x, y)
      if (luma(r, g, b) > 210) continue
      const lab = rgbToLab(r, g, b)
      // Forehead: close to the measured skin colour (dark-brown hair can pass a generic skin test, so that is not used here).
      if (deltaE(lab, skin.lab) < 12) continue
      const h = hueAngle(lab)
      // Hair is low-chroma or in the red–yellow range; blue/green/purple is background or clothing.
      if (chroma(lab) >= 15 && (h < 15 || h > 95)) continue
      band.push(lab)
    }
  }
  const coverage = band.length / Math.max(1, total)
  if (band.length < 40 || coverage < 0.3) return UNKNOWN
  const sorted = [...band].sort((p, q) => p.L - q.L)
  const trimmed = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.9))) // drop highlights
  const lab = meanLab(trimmed)
  const spread = std(trimmed.map((p) => p.L))
  // The same rows at the image edges are background: hair that matches them cannot be told apart.
  const edge: Lab[] = []
  const ew = Math.max(2, Math.round(c.width * 0.08))
  for (let y = top; y < faceTop; y++) {
    for (let x = 0; x < ew; x++) {
      edge.push(rgbToLab(...px(c, x, y)), rgbToLab(...px(c, c.width - 1 - x, y)))
    }
  }
  if (edge.length > 0 && deltaE(lab, meanLab(edge)) < 10) return UNKNOWN
  const confidence = round2(Math.min(CONFIDENCE.hairMax, coverage * clamp(1 - spread / 25, 0, 1)))
  if (confidence < CONFIDENCE.hairMin) return UNKNOWN
  return { color: hairColorOf(lab), lab, confidence }
}

export function eyeColorOf(c: Lab): string {
  const C = chroma(c)
  if (c.b < -4 && c.L > 25) return 'blue'
  if (c.a < -3 && c.b > 4) return 'green'
  if (C < 8 && c.L > 40) return 'gray'
  return 'brown'
}

/**
 * Eyes only when two dark regions sit symmetrically where eyes would be
 * inside the skin region. No face landmarks exist here, so anything less
 * clear is unknown (never a guessed colour).
 */
export function measureEyes(c: Canvas, skin: SkinRegion): FeatureColor {
  const { top, bottom, left, right } = skin.box
  const fw = right - left + 1, fh = bottom - top + 1
  if (fw < 40 || fh < 50) return UNKNOWN
  const y0 = Math.floor(top + 0.25 * fh), y1 = Math.ceil(top + 0.5 * fh)
  const mid = left + fw / 2
  const dark = skin.luma * 0.7
  type Side = { n: number; total: number; sx: number; sy: number; pixels: Array<{ lab: Lab; l: number }> }
  const side = (x0: number, x1: number): Side => {
    const s: Side = { n: 0, total: 0, sx: 0, sy: 0, pixels: [] }
    for (let y = y0; y < y1; y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        s.total++
        const [r, g, b] = px(c, x, y)
        const l = luma(r, g, b)
        if (isSkinPixel(r, g, b) || l >= dark) continue
        s.n++
        s.sx += x
        s.sy += y
        s.pixels.push({ lab: rgbToLab(r, g, b), l })
      }
    }
    return s
  }
  const L = side(left + 0.1 * fw, mid - 0.05 * fw)
  const R = side(mid + 0.05 * fw, right - 0.1 * fw)
  const share = (s: Side) => s.n / Math.max(1, s.total)
  for (const s of [L, R]) if (s.n < 6 || share(s) < 0.01 || share(s) > 0.2) return UNKNOWN
  if (Math.max(L.n, R.n) > 3 * Math.min(L.n, R.n)) return UNKNOWN
  const ly = L.sy / L.n, ry = R.sy / R.n
  if (Math.abs(ly - ry) > 0.08 * fh) return UNKNOWN
  const dl = mid - L.sx / L.n, dr = R.sx / R.n - mid
  if (dl <= 0 || dr <= 0 || Math.abs(dl - dr) > 0.25 * Math.max(dl, dr)) return UNKNOWN
  // Iris: drop the darkest 30 % (pupils, lashes).
  const all = [...L.pixels, ...R.pixels].sort((p, q) => p.l - q.l)
  const iris = all.slice(Math.floor(all.length * 0.3))
  if (iris.length < 4) return UNKNOWN
  const lab = meanLab(iris.map((p) => p.lab))
  return { color: eyeColorOf(lab), lab, confidence: CONFIDENCE.eyeMax }
}

// ─── Contrast and season ────────────────────────────────────────────────────

export function contrastOf(skin: Lab, hair: Lab | null, eyes: Lab | null): { level: ContrastLevel; value: number } | null {
  const diffs = [hair ? Math.abs(skin.L - hair.L) : null, eyes ? 0.8 * Math.abs(skin.L - eyes.L) : null].filter((d): d is number => d !== null)
  if (diffs.length === 0) return null
  const value = Math.max(...diffs)
  return { level: value >= 40 ? 'high' : value >= 22 ? 'medium' : 'low', value }
}

/** Prototypes on warmth, lightness, chroma (clear vs muted) and contrast, each in [-1, 1]. */
export const SEASON_PROTOTYPES: Record<Season, { warmth: number; lightness: number; chroma: number; contrast: number }> = {
  spring: { warmth: 0.8, lightness: 0.6, chroma: 0.6, contrast: 0 },
  summer: { warmth: -0.8, lightness: 0.6, chroma: -0.6, contrast: -0.6 },
  autumn: { warmth: 0.8, lightness: -0.5, chroma: -0.4, contrast: 0 },
  winter: { warmth: -0.8, lightness: -0.4, chroma: 0.6, contrast: 0.8 },
}
const WEIGHTS = { warmth: 0.4, lightness: 0.25, chroma: 0.15, contrast: 0.2 }
const SOFTMAX_T = 0.25

export interface SeasonFeatures {
  /** null when the undertone is unknown. */
  warmth: number | null
  lightness: number
  chroma: number
  /** null when neither hair nor eyes are known. */
  contrast: number | null
}

export function seasonFeatures(skin: Lab, undertoneKnown: boolean, hair: Lab | null, contrast: number | null): SeasonFeatures {
  const skinLight = clamp((skin.L - 58) / 14)
  return {
    warmth: undertoneKnown ? clamp((hueAngle(skin) - 50) / 9) : null,
    lightness: hair ? 0.75 * skinLight + 0.25 * clamp((hair.L - 35) / 25) : skinLight,
    chroma: clamp((chroma(skin) - 20) / 8),
    contrast: contrast === null ? null : clamp((contrast - 28) / 20),
  }
}

/** Probabilities over the four seasons (softmax of the negative weighted distance). */
export function seasonProbabilities(f: SeasonFeatures): Array<{ season: Season; p: number }> {
  const dims = (['warmth', 'lightness', 'chroma', 'contrast'] as const).filter((d) => f[d] !== null)
  const wsum = dims.reduce((s, d) => s + WEIGHTS[d], 0)
  const scores = (Object.keys(SEASON_PROTOTYPES) as Season[]).map((season) => {
    const proto = SEASON_PROTOTYPES[season]
    const d = dims.reduce((s, dim) => s + WEIGHTS[dim] * ((f[dim] as number) - proto[dim]) ** 2, 0) / wsum
    return { season, score: -d / SOFTMAX_T }
  })
  const max = Math.max(...scores.map((s) => s.score))
  const exp = scores.map((s) => ({ season: s.season, e: Math.exp(s.score - max) }))
  const total = exp.reduce((s, e) => s + e.e, 0)
  return exp.map((e) => ({ season: e.season, p: e.e / total })).sort((a, b) => b.p - a.p || (a.season < b.season ? -1 : 1))
}

/** Confidence cap: lower when a dimension of the evidence is missing. */
export function confidenceCap(undertoneKnown: boolean, contrastKnown: boolean): number {
  let cap: number = CONFIDENCE.max
  if (!undertoneKnown) cap = Math.min(cap, CONFIDENCE.withoutUndertone)
  if (!contrastKnown) cap = Math.min(cap, CONFIDENCE.withoutContrast)
  return cap
}

/** The season (or none, when the evidence is too weak) and the runner-up. */
export function decideSeason(probs: Array<{ season: Season; p: number }>, evidence: number, cap: number) {
  const confidence = round2(Math.min(cap, probs[0].p * evidence))
  if (confidence < CONFIDENCE.seasonMin) return { season: null, confidence, secondarySeason: null, secondaryConfidence: null }
  return { season: probs[0].season, confidence, secondarySeason: probs[1].season, secondaryConfidence: round2(Math.min(cap, probs[1].p * evidence)) }
}

// ─── Palettes ───────────────────────────────────────────────────────────────

const SEASONAL_PALETTES: Record<Season, { recommended: string[]; neutral: string[]; caution: string[] }> = {
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
const inCatalog = (ids: string[]) => ids.filter((id) => COLORS.some((c) => c.id === id))

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ColorAnalysisResult {
  version: string
  skinTone: SkinTone
  undertone: Undertone
  undertoneConfidence: number
  hairColor: string | null
  eyeColor: string | null
  contrastLevel: ContrastLevel | null
  /** null when the evidence does not support any season. */
  season: Season | null
  /** Overall confidence of the profile (= the season's), 0–0.8. */
  confidence: number
  secondarySeason: Season | null
  secondaryConfidence: number | null
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
  /** Stored for audit/calibration: no colour values, no image data. */
  analysis: {
    version: string
    quality: number
    skinPixels: number
    skinRegions: number
    agreement: number
    hairKnown: boolean
    eyesKnown: boolean
  }
}

export interface AnalyzeSelfieInput {
  buffer: Buffer
}

export async function analyzeSelfie(input: AnalyzeSelfieInput): Promise<ColorAnalysisResult> {
  const canvas = await loadCanvas(input.buffer)
  return analyzeCanvas(canvas)
}

export function analyzeCanvas(canvas: Canvas): ColorAnalysisResult {
  const quality = assessQuality(measureQuality(canvas))
  const skin = measureSkin(canvas)
  const sampleFactor = clamp(skin.pixels / 2500, 0.4, 1)

  const hue = hueAngle(skin.lab)
  const marginFactor = clamp(undertoneMargin(hue) / 3, 0, 1)
  const undertoneConfidence = round2(Math.min(CONFIDENCE.undertoneMax, (0.35 + 0.65 * marginFactor) * skin.agreement * quality * sampleFactor))
  const undertone: Undertone = undertoneConfidence >= CONFIDENCE.undertoneMin ? classifyUndertone(hue) : 'unknown'

  const hair = measureHair(canvas, skin)
  const eyes = measureEyes(canvas, skin)
  const contrast = contrastOf(skin.lab, hair.lab, eyes.lab)

  const probs = seasonProbabilities(seasonFeatures(skin.lab, undertone !== 'unknown', hair.lab, contrast?.value ?? null))
  const evidence = quality * sampleFactor * (0.5 + 0.5 * skin.agreement)
  const { season, confidence, secondarySeason, secondaryConfidence } = decideSeason(probs, evidence, confidenceCap(undertone !== 'unknown', contrast !== null))
  const palette = season ? SEASONAL_PALETTES[season] : null

  return {
    version: COLOR_ANALYSIS_VERSION,
    skinTone: classifySkinTone(skin.lab.L),
    undertone,
    undertoneConfidence,
    hairColor: hair.color,
    eyeColor: eyes.color,
    contrastLevel: contrast?.level ?? null,
    season,
    confidence,
    secondarySeason,
    secondaryConfidence,
    recommendedColors: palette ? inCatalog(palette.recommended) : [],
    neutralColors: palette ? inCatalog(palette.neutral) : [],
    cautionColors: palette ? inCatalog(palette.caution) : [],
    analysis: {
      version: COLOR_ANALYSIS_VERSION,
      quality: round2(quality),
      skinPixels: skin.pixels,
      skinRegions: skin.cells,
      agreement: round2(skin.agreement),
      hairKnown: hair.color !== null,
      eyesKnown: eyes.color !== null,
    },
  }
}
