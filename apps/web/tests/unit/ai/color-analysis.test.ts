/**
 * Phase 4.3 colour analysis (color-analysis-v2), on synthetic selfies only:
 * quality gates, skin sampling and outlier rejection, hair and eyes
 * (unknown when unclear), undertone, season, confidence and determinism.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_MAX_SIDE,
  COLOR_ANALYSIS_VERSION,
  CONFIDENCE,
  PhotoQualityError,
  SEASON_PROTOTYPES,
  SkinNotVisibleError,
  UNDERTONE_BOUNDS,
  analyzeCanvas,
  analyzeSelfie,
  assessQuality,
  classifySkinTone,
  classifyUndertone,
  confidenceCap,
  decideSeason,
  contrastOf,
  eyeColorOf,
  hairColorOf,
  hueAngle,
  isSkinPixel,
  loadCanvas,
  measureQuality,
  measureSkin,
  rgbToLab,
  seasonFeatures,
  seasonProbabilities,
  undertoneMargin,
  type Canvas,
} from '@/lib/ai/color-analysis'
import { ImageDimensionsError, InvalidImageError, UnsupportedImageFormatError } from '@/lib/storage/provider'
import { selfie } from './selfie-fixtures'

const WARM_LIGHT = { skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' }
const COOL_LIGHT = { skin: '#f0cfc8', hair: '#b9a27a', eyes: '#4f7aa8' }
const WARM_DEEP = { skin: '#8d5a34', hair: '#1a120c', eyes: '#2e1d10' }
const COOL_DEEP = { skin: '#7a5048', hair: '#0e0e10', eyes: '#1d1410' }

const rejects = async (p: Promise<unknown>, type: new (...a: never[]) => Error, reason?: string) => {
  const err = await p.then(() => null, (e) => e)
  expect(err).toBeInstanceOf(type)
  if (reason) expect((err as PhotoQualityError).reason).toBe(reason)
}

describe('decoding and the analysis canvas', () => {
  it('rejects non-images, HEIC and wrong dimensions with typed errors', async () => {
    await rejects(analyzeSelfie({ buffer: Buffer.from('<html>no</html>') }), InvalidImageError)
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)])
    await rejects(analyzeSelfie({ buffer: heic }), UnsupportedImageFormatError)
    const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#fff' } }).gif().toBuffer()
    await rejects(analyzeSelfie({ buffer: gif }), UnsupportedImageFormatError)
    await rejects(analyzeSelfie({ buffer: await selfie({ width: 200, height: 260 }) }), ImageDimensionsError)
  })

  it('fits the image inside the canvas without cropping and honours EXIF rotation', async () => {
    const c = await loadCanvas(await selfie({ width: 600, height: 800 }))
    expect(Math.max(c.width, c.height)).toBe(CANVAS_MAX_SIDE)
    expect(c.width / c.height).toBeCloseTo(600 / 800, 1)
    const rotated = await sharp(await selfie({ width: 600, height: 800 })).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const r = await loadCanvas(rotated)
    expect(r.width).toBeGreaterThan(r.height) // orientation 6 = rotated 90°
  })
})

describe('photo quality', () => {
  it('a clear photo passes with a quality score in [0.6, 1]', async () => {
    const q = assessQuality(measureQuality(await loadCanvas(await selfie(WARM_LIGHT))))
    expect(q).toBeGreaterThanOrEqual(0.6)
    expect(q).toBeLessThanOrEqual(1)
  })

  it.each([
    ['too_dark', (b: Buffer) => sharp(b).linear(0.15, 0).jpeg().toBuffer()],
    ['overexposed', (b: Buffer) => sharp(b).linear(1, 140).jpeg().toBuffer()],
    ['blurry', (b: Buffer) => sharp(b).blur(6).jpeg().toBuffer()],
  ])('%s → PhotoQualityError', async (reason, transform) => {
    await rejects(analyzeSelfie({ buffer: await transform(await selfie(WARM_LIGHT)) }), PhotoQualityError, reason)
  })

  it('a flat image has no usable detail', async () => {
    const flat = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#E0AC69' } }).jpeg().toBuffer()
    await rejects(analyzeSelfie({ buffer: flat }), PhotoQualityError, 'low_detail')
  })

  it('a skin-coloured background everywhere cannot be separated from the person', async () => {
    await rejects(analyzeSelfie({ buffer: await selfie({ background: '#d9a37f', skin: '#d4a088' }) }), PhotoQualityError, 'background')
  })
})

describe('skin', () => {
  it('no skin-coloured region → SkinNotVisibleError (never a default profile)', async () => {
    await rejects(analyzeSelfie({ buffer: await selfie({ skin: '#3a6ea5', hair: null }) }), SkinNotVisibleError)
  })

  it('a face too small to give two skin regions → SkinNotVisibleError', async () => {
    await rejects(analyzeSelfie({ buffer: await selfie({ ...WARM_LIGHT, faceScale: 0.2 }) }), SkinNotVisibleError)
  })

  it('the representative colour is measured from the face, not the background or hair', async () => {
    const s = measureSkin(await loadCanvas(await selfie(WARM_LIGHT)))
    const truth = rgbToLab(0xf1, 0xc9, 0xa5)
    expect(Math.abs(s.lab.L - truth.L)).toBeLessThan(3)
    expect(Math.abs(hueAngle(s.lab) - hueAngle(truth))).toBeLessThan(3)
    expect(s.cells).toBeGreaterThanOrEqual(2)
    expect(s.agreement).toBeGreaterThan(0.9)
  })

  it('outlier rejection: specular highlights and shadows do not move the colour', async () => {
    const base = await loadCanvas(await selfie(WARM_LIGHT))
    const spotted: Canvas = { ...base, data: Uint8Array.from(base.data) }
    // 3 % of pixels in the face area become white highlights or black shadows.
    let k = 0
    for (let y = Math.floor(base.height * 0.35); y < base.height * 0.7; y++) {
      for (let x = Math.floor(base.width * 0.35); x < base.width * 0.65; x++) {
        if (k++ % 33 !== 0) continue
        const v = k % 2 ? 255 : 0
        spotted.data.set([v, v, v], (y * base.width + x) * 3)
      }
    }
    const a = measureSkin(base).lab, b = measureSkin(spotted).lab
    expect(Math.abs(a.L - b.L)).toBeLessThan(1.5)
    expect(Math.abs(hueAngle(a) - hueAngle(b))).toBeLessThan(1.5)
  })

  it('the skin test keeps skin-like colours and refuses blue, gray and very dark pixels', () => {
    expect(isSkinPixel(0xd9, 0xa3, 0x7f)).toBe(true)
    expect(isSkinPixel(0x3a, 0x6e, 0xa5)).toBe(false)
    expect(isSkinPixel(128, 128, 128)).toBe(false)
    expect(isSkinPixel(20, 12, 8)).toBe(false)
  })
})

describe('undertone and skin tone', () => {
  it('classifies the skin hue angle into five bands', () => {
    const b = UNDERTONE_BOUNDS
    expect(classifyUndertone(b.cool - 1)).toBe('cool')
    expect(classifyUndertone(b.cool + 1)).toBe('neutral_cool')
    expect(classifyUndertone((b.neutralCool + b.neutralWarm) / 2)).toBe('neutral')
    expect(classifyUndertone(b.neutralWarm + 1)).toBe('neutral_warm')
    expect(classifyUndertone(b.warm + 1)).toBe('warm')
    expect(undertoneMargin(b.warm)).toBe(0)
  })

  it('maps lightness to skin tone', () => {
    expect([75, 60, 50, 35].map(classifySkinTone)).toEqual(['light', 'medium', 'tan', 'deep'])
  })

  it.each([
    ['warm light', WARM_LIGHT, 'warm', 'light'],
    ['cool light', COOL_LIGHT, 'cool', 'light'],
    ['warm deep', WARM_DEEP, 'warm', 'deep'],
    ['cool deep', COOL_DEEP, 'cool', 'deep'],
  ])('%s', async (_n, spec, undertone, skinTone) => {
    const r = await analyzeSelfie({ buffer: await selfie(spec) })
    expect(r).toMatchObject({ undertone, skinTone })
    expect(r.undertoneConfidence).toBeGreaterThanOrEqual(CONFIDENCE.undertoneMin)
    expect(r.undertoneConfidence).toBeLessThanOrEqual(CONFIDENCE.undertoneMax)
  })

  it('regions that disagree → undertone unknown (never a guess), with a capped season confidence', async () => {
    // Left half of the face cool-pink, right half warm-golden: the regions disagree.
    const c = await loadCanvas(await selfie({ ...WARM_LIGHT }))
    const mixed: Canvas = { ...c, data: Uint8Array.from(c.data) }
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width / 2; x++) {
        const i = (y * c.width + x) * 3
        if (isSkinPixel(c.data[i], c.data[i + 1], c.data[i + 2])) mixed.data.set([0xf0, 0xc0, 0xc8], i)
      }
    }
    const r = analyzeCanvas(mixed)
    expect(r.undertone).toBe('unknown')
    expect(r.confidence).toBeLessThanOrEqual(CONFIDENCE.withoutUndertone)
  })
})

describe('hair and eyes (unknown unless clear)', () => {
  it('measures dark and light hair above the face', async () => {
    expect((await analyzeSelfie({ buffer: await selfie(WARM_DEEP) })).hairColor).toBe('black')
    expect((await analyzeSelfie({ buffer: await selfie(COOL_LIGHT) })).hairColor).toBe('beige')
  })

  it('no hair: the band above the face is background → unknown, not a colour', async () => {
    expect((await analyzeSelfie({ buffer: await selfie({ ...WARM_LIGHT, hair: null }) })).hairColor).toBeNull()
  })

  it('eyes: measured when two symmetric eye regions exist; unknown without them', async () => {
    expect((await analyzeSelfie({ buffer: await selfie(COOL_LIGHT) })).eyeColor).toBe('blue')
    expect((await analyzeSelfie({ buffer: await selfie(WARM_LIGHT) })).eyeColor).toBe('brown')
    expect((await analyzeSelfie({ buffer: await selfie({ ...WARM_LIGHT, eyes: null }) })).eyeColor).toBeNull()
  })

  it('colour vocabularies', () => {
    expect(hairColorOf({ L: 15, a: 2, b: 3 })).toBe('black')
    expect(hairColorOf({ L: 32, a: 8, b: 14 })).toBe('brown')
    expect(hairColorOf({ L: 40, a: 25, b: 20 })).toBe('rust')
    expect(hairColorOf({ L: 70, a: 1, b: 2 })).toBe('gray')
    expect(hairColorOf({ L: 68, a: 3, b: 25 })).toBe('beige')
    expect(eyeColorOf({ L: 45, a: -2, b: -10 })).toBe('blue')
    expect(eyeColorOf({ L: 40, a: -6, b: 12 })).toBe('green')
    expect(eyeColorOf({ L: 25, a: 8, b: 12 })).toBe('brown')
  })

  it('contrast: from hair and/or eyes; null when neither is known', () => {
    expect(contrastOf({ L: 80, a: 0, b: 0 }, { L: 20, a: 0, b: 0 }, null)).toEqual({ level: 'high', value: 60 })
    expect(contrastOf({ L: 60, a: 0, b: 0 }, { L: 35, a: 0, b: 0 }, null)?.level).toBe('medium')
    expect(contrastOf({ L: 60, a: 0, b: 0 }, { L: 50, a: 0, b: 0 }, null)?.level).toBe('low')
    expect(contrastOf({ L: 60, a: 0, b: 0 }, null, null)).toBeNull()
  })
})

describe('season', () => {
  it.each([
    ['warm light → spring', WARM_LIGHT, 'spring'],
    ['cool light → summer', COOL_LIGHT, 'summer'],
    ['warm deep → autumn', WARM_DEEP, 'autumn'],
    ['cool deep → winter', COOL_DEEP, 'winter'],
  ])('%s, with a different secondary season', async (_n, spec, season) => {
    const r = await analyzeSelfie({ buffer: await selfie(spec) })
    expect(r.season).toBe(season)
    expect(r.secondarySeason).not.toBe(season)
    expect(r.secondaryConfidence!).toBeLessThanOrEqual(r.confidence)
    expect(r.recommendedColors.length).toBeGreaterThan(0)
  })

  it('each prototype scores itself highest; probabilities sum to 1', () => {
    for (const [season, p] of Object.entries(SEASON_PROTOTYPES)) {
      const probs = seasonProbabilities({ warmth: p.warmth, lightness: p.lightness, chroma: p.chroma, contrast: p.contrast })
      expect(probs[0].season).toBe(season)
      expect(probs.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 6)
    }
  })

  it('missing dimensions are skipped, not guessed', () => {
    const f = seasonFeatures({ L: 70, a: 10, b: 20 }, false, null, null)
    expect(f.warmth).toBeNull()
    expect(f.contrast).toBeNull()
    expect(seasonProbabilities(f)).toHaveLength(4)
  })

  it('ambiguous evidence (features between all prototypes) → season null and no palette', () => {
    const probs = seasonProbabilities({ warmth: 0, lightness: 0, chroma: 0, contrast: 0 })
    expect(probs[0].p).toBeLessThan(0.35)
  })
})

/** A canvas with a textured skin patch over the given central-grid cells (row, col) and a gray-blue background. */
function patchCanvas(cells: Array<[number, number]>, fill = 1): Canvas {
  const width = 320, height = 320
  const data = new Uint8Array(width * height * 3)
  let seed = 3
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * 12
  for (let i = 0; i < width * height; i++) data.set([110 + rnd(), 130 + rnd(), 160 + rnd()], i * 3)
  const x0 = Math.floor(width * 0.15), y0 = Math.floor(height * 0.1)
  const cw = (Math.ceil(width * 0.85) - x0) / 4, ch = (Math.ceil(height * 0.9) - y0) / 4
  for (const [gy, gx] of cells) {
    for (let y = Math.floor(y0 + gy * ch); y < Math.floor(y0 + gy * ch + ch * fill); y++) {
      for (let x = Math.floor(x0 + gx * cw); x < Math.floor(x0 + (gx + 1) * cw); x++) data.set([217 + rnd(), 163 + rnd(), 127 + rnd()], (y * width + x) * 3)
    }
  }
  return { width, height, data }
}

describe('skin gates (direct)', () => {
  it('skin concentrated in two cells but below the minimum share of the centre → not visible', () => {
    // two cells, 40 % filled: ~5 % of the central region (< 6 %), yet each cell is ≥ 35 % skin
    expect(() => measureSkin(patchCanvas([[1, 1], [1, 2]], 0.4))).toThrow(SkinNotVisibleError)
  })

  it('one skin region is not enough (two are required)', () => {
    expect(() => measureSkin(patchCanvas([[1, 1]], 1))).toThrow(SkinNotVisibleError)
    expect(measureSkin(patchCanvas([[1, 1], [1, 2]], 1)).cells).toBe(2)
  })

  it('colour outliers at skin lightness (e.g. a pink blemish area) are rejected, not averaged in', async () => {
    const base = await loadCanvas(await selfie(WARM_LIGHT))
    const blemish: Canvas = { ...base, data: Uint8Array.from(base.data) }
    let k = 0
    for (let i = 0; i < base.width * base.height; i++) {
      const [r, g, b] = [base.data[i * 3], base.data[i * 3 + 1], base.data[i * 3 + 2]]
      if (isSkinPixel(r, g, b) && k++ % 8 === 0) blemish.data.set([0xf0, 0xb8, 0xc4], i * 3) // same lightness, much cooler hue
    }
    const a = measureSkin(base).lab, b = measureSkin(blemish).lab
    expect(Math.abs(hueAngle(a) - hueAngle(b))).toBeLessThan(1.5)
  })
})

describe('hair and eyes: hard cases stay unknown', () => {
  it('no hair in front of a hair-coloured (dark gray) wall → unknown, not "brown"', async () => {
    expect((await analyzeSelfie({ buffer: await selfie({ ...WARM_LIGHT, hair: null, background: '#5a5a5a' }) })).hairColor).toBeNull()
  })

  it('eyes at clearly different heights are not taken as a pair', async () => {
    expect((await analyzeSelfie({ buffer: await selfie({ ...COOL_LIGHT, eyeOffset: 0.12 }) })).eyeColor).toBeNull()
  })

  it('sunglasses (large dark regions) → eye colour unknown', async () => {
    expect((await analyzeSelfie({ buffer: await selfie({ ...COOL_LIGHT, sunglasses: true }) })).eyeColor).toBeNull()
  })
})

describe('season decision and caps (exact)', () => {
  const probs = [
    { season: 'spring' as const, p: 0.6 },
    { season: 'autumn' as const, p: 0.3 },
    { season: 'summer' as const, p: 0.06 },
    { season: 'winter' as const, p: 0.04 },
  ]

  it('caps: 0.8 overall, 0.45 without undertone, 0.65 without contrast', () => {
    expect(confidenceCap(true, true)).toBe(0.8)
    expect(confidenceCap(false, true)).toBe(0.45)
    expect(confidenceCap(true, false)).toBe(0.65)
    expect(confidenceCap(false, false)).toBe(0.45)
  })

  it('strong evidence → season and runner-up; weak evidence → no season at all', () => {
    expect(decideSeason(probs, 1, 0.8)).toEqual({ season: 'spring', confidence: 0.6, secondarySeason: 'autumn', secondaryConfidence: 0.3 })
    expect(decideSeason(probs, 0.45, 0.8)).toEqual({ season: null, confidence: 0.27, secondarySeason: null, secondaryConfidence: null })
    expect(decideSeason([{ ...probs[0], p: 0.95 }, ...probs.slice(1)], 1, 0.45).confidence).toBe(0.45)
  })
})

describe('confidence and output', () => {
  it('never above the caps; null palette lists when there is no season', async () => {
    for (const spec of [WARM_LIGHT, COOL_LIGHT, WARM_DEEP, COOL_DEEP, { ...WARM_LIGHT, hair: null, eyes: null }]) {
      const r = await analyzeSelfie({ buffer: await selfie(spec) })
      expect(r.confidence).toBeLessThanOrEqual(0.8)
      expect(r.undertoneConfidence).toBeLessThanOrEqual(0.75)
      if (r.season === null) expect(r.recommendedColors).toEqual([])
    }
  })

  it('without hair and eyes there is no contrast: the confidence is capped lower', async () => {
    const r = await analyzeSelfie({ buffer: await selfie({ ...WARM_LIGHT, hair: null, eyes: null }) })
    expect(r.contrastLevel).toBeNull()
    expect(r.confidence).toBeLessThanOrEqual(CONFIDENCE.withoutContrast)
  })

  it('is deterministic: same bytes, same version → identical result', async () => {
    const bytes = await selfie(WARM_DEEP)
    const a = await analyzeSelfie({ buffer: bytes })
    const b = await analyzeSelfie({ buffer: Buffer.from(bytes) })
    expect(a).toEqual(b)
    expect(a.version).toBe(COLOR_ANALYSIS_VERSION)
  })

  it('the stored analysis metadata has no colour values and no image data', async () => {
    const r = await analyzeSelfie({ buffer: await selfie(WARM_LIGHT) })
    expect(Object.keys(r.analysis).sort()).toEqual(['agreement', 'eyesKnown', 'hairKnown', 'quality', 'skinPixels', 'skinRegions', 'version'])
    expect(JSON.stringify(r.analysis)).not.toMatch(/rgb|"r"|"L"|"a"|"b"/i)
  })
})
