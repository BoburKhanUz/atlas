/**
 * Golden vectors of the selfie colour analysis for the Go backend (stage
 * B6.7; src/lib/ai/color-analysis.ts, color-analysis-v2): what
 * analyzeCanvas makes of synthetic selfie canvases, and the pure steps on
 * hand-picked values.
 *
 * Each canvas is a synthetic selfie (tests/unit/ai/selfie-fixtures.ts's
 * drawing: no real person) rendered at the canvas's own size, stored as a
 * lossless PNG without noise, with the noise (the fixture's seeded LCG) and
 * the edits that follow it described: the Go test applies them to the
 * decoded pixels the same way, so both sides analyse the same bytes.
 *
 *   bun scripts/golden-color.ts ../api/testdata/golden/color.json
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  CANVAS_MAX_SIDE, COLOR_ANALYSIS_VERSION, CONFIDENCE, PhotoQualityError, QUALITY, SEASONAL_PALETTES, SEASON_PROTOTYPES, SKIN, SkinNotVisibleError,
  UNDERTONE_BOUNDS, analyzeCanvas, classifySkinTone, classifyUndertone, confidenceCap, contrastOf, decideSeason, eyeColorOf, hairColorOf,
  hueAngle, chroma, isSkinPixel, measureQuality, measureSkin, rgbToLab, seasonFeatures, seasonProbabilities, undertoneMargin, type Canvas, type Lab, type Season,
} from '../src/lib/ai/color-analysis'
import { selfieSvg, type SelfieSpec } from '../tests/unit/ai/selfie-fixtures'

type Edit =
  | { op: 'skinLeft'; rgb: [number, number, number] }
  | { op: 'rect'; x: number; y: number; w: number; h: number; rgb: [number, number, number] }
  | { op: 'scale'; num: number; den: number }
  | { op: 'blur'; r: number }

/** The fixture's noise generator. */
function lcg(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function addNoise(data: Uint8Array, amp: number, seed: number) {
  if (amp <= 0) return
  const rnd = lcg(seed)
  for (let i = 0; i < data.length; i += 3) {
    const n = (rnd() - 0.5) * 2 * amp
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] + n)))
  }
}

function applyEdit(c: Canvas, e: Edit) {
  const d = c.data
  switch (e.op) {
    case 'skinLeft':
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width / 2; x++) {
          const i = (y * c.width + x) * 3
          if (isSkinPixel(d[i], d[i + 1], d[i + 2])) d.set(e.rgb, i)
        }
      }
      return
    case 'rect':
      for (let y = e.y; y < Math.min(c.height, e.y + e.h); y++) {
        for (let x = e.x; x < Math.min(c.width, e.x + e.w); x++) d.set(e.rgb, (y * c.width + x) * 3)
      }
      return
    case 'scale':
      for (let i = 0; i < d.length; i++) d[i] = Math.min(255, Math.floor((d[i] * e.num) / e.den))
      return
    case 'blur': {
      // A box blur: each channel the floor of the mean over the window
      // clipped to the canvas, read from the unblurred pixels.
      const src = Uint8Array.from(d)
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0, n = 0
            for (let yy = Math.max(0, y - e.r); yy <= Math.min(c.height - 1, y + e.r); yy++) {
              for (let xx = Math.max(0, x - e.r); xx <= Math.min(c.width - 1, x + e.r); xx++) {
                sum += src[(yy * c.width + xx) * 3 + ch]
                n++
              }
            }
            d[(y * c.width + x) * 3 + ch] = Math.floor(sum / n)
          }
        }
      }
    }
  }
}

const WARM_LIGHT = { skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' }
const COOL_LIGHT = { skin: '#f0cfc8', hair: '#b9a27a', eyes: '#4f7aa8' }
const WARM_DEEP = { skin: '#8d5a34', hair: '#1a120c', eyes: '#2e1d10' }
const COOL_DEEP = { skin: '#7a5048', hair: '#0e0e10', eyes: '#1d1410' }

interface Case {
  name: string
  spec: SelfieSpec
  noise: number
  seed: number
  edits: Edit[]
}
const cases: Case[] = []
const add = (name: string, spec: SelfieSpec, edits: Edit[] = [], noise = 14, seed = 7) => cases.push({ name, spec: { width: 240, height: 320, ...spec }, noise, seed, edits })

add('warm light', WARM_LIGHT)
add('cool light', COOL_LIGHT)
add('warm deep', WARM_DEEP)
add('cool deep', COOL_DEEP)
add('no hair', { ...WARM_LIGHT, hair: null })
add('no eyes', { ...WARM_LIGHT, eyes: null })
add('no hair and no eyes', { ...WARM_LIGHT, hair: null, eyes: null })
add('no hair before a dark gray wall', { ...WARM_LIGHT, hair: null, background: '#5a5a5a' })
add('eyes at different heights', { ...COOL_LIGHT, eyeOffset: 0.12 })
add('sunglasses', { ...COOL_LIGHT, sunglasses: true })
add('a face too small', { ...WARM_LIGHT, faceScale: 0.2 })
add('no skin', { skin: '#3a6ea5', hair: null })
add('a skin-coloured background', { background: '#d9a37f', skin: '#d4a088' })
add('a skin-coloured background around a face that is not skin', { background: '#d9a37f', skin: '#3a6ea5', hair: null })
add('a skin-coloured background around a small face', { background: '#d9a37f', skin: '#f0cfc8', faceScale: 0.5 })
add('no noise', WARM_LIGHT, [], 0)
add('flat', { skin: '#e0ac69', background: '#e0ac69', hair: null, eyes: null }, [{ op: 'rect', x: 0, y: 0, w: 240, h: 320, rgb: [0xe0, 0xac, 0x69] }], 0)
add('too dark', WARM_LIGHT, [{ op: 'scale', num: 15, den: 100 }])
add('overexposed', WARM_LIGHT, [{ op: 'scale', num: 300, den: 100 }])
add('regions that disagree', WARM_LIGHT, [{ op: 'skinLeft', rgb: [0xf0, 0xc0, 0xc8] }])
add('a highlight on the face', WARM_LIGHT, [{ op: 'rect', x: 100, y: 170, w: 30, h: 20, rgb: [255, 255, 255] }])
add('a shadow on the face', WARM_LIGHT, [{ op: 'rect', x: 80, y: 200, w: 40, h: 30, rgb: [60, 40, 30] }])
add('a pink blemish area', WARM_LIGHT, [{ op: 'rect', x: 90, y: 190, w: 50, h: 40, rgb: [0xff, 0x8f, 0xb0] }])
add('landscape', { ...WARM_DEEP, width: 320, height: 240 })
add('small', { ...COOL_LIGHT, width: 120, height: 160 })
add('largest', { ...COOL_DEEP, width: 320, height: 320 })
add('another seed', COOL_LIGHT, [], 20, 12345)
add('blurred', WARM_LIGHT, [{ op: 'blur', r: 4 }])
for (const skin of ['#c8a088', '#a88470', '#b8a090']) add(`muted ${skin}`, { skin, hair: null, eyes: null }, [], 30)
for (const [num, noise] of [[80, 14], [65, 14], [55, 14], [65, 24]]) {
  add(`regions that disagree, darker ${num}%, noise ${noise}`, WARM_LIGHT, [{ op: 'skinLeft', rgb: [0xf0, 0xc0, 0xc8] }, { op: 'scale', num, den: 100 }], noise)
}

// The edges of the thresholds: small faces (few skin pixels, few cells),
// a tiny canvas, hair close to the skin or bright or out of the hair hues,
// hair partly hidden or noisy, one eye hidden, eyes off centre.
for (const k of [0.28, 0.32, 0.36, 0.42, 0.5]) add(`face scale ${k}`, { ...WARM_LIGHT, width: 320, height: 320, faceScale: k })
for (const k of [0.3, 0.4]) add(`face scale ${k}, cool`, { ...COOL_DEEP, width: 320, height: 300, faceScale: k })
add('tiny', { ...WARM_LIGHT, width: 48, height: 64 })
add('very small', { ...COOL_LIGHT, width: 72, height: 96 })
add('small with eyes', { ...WARM_DEEP, width: 100, height: 130 })
for (const hair of ['#c89878', '#d8a888', '#e8e8e8', '#f4f0f0', '#b04060', '#8040a0', '#a05030', '#606060', '#9a9a9a']) add(`hair ${hair}`, { ...WARM_LIGHT, hair })
add('noisy hair', { ...WARM_DEEP }, [], 40, 99)
add('noisy light hair', { ...COOL_LIGHT }, [], 45, 3)
add('hair mostly hidden', WARM_LIGHT, [{ op: 'rect', x: 0, y: 40, w: 240, h: 55, rgb: [0x6f, 0x8f, 0xb0] }, { op: 'rect', x: 108, y: 70, w: 24, h: 25, rgb: [0x3b, 0x24, 0x16] }])
add('hair partly hidden', WARM_LIGHT, [{ op: 'rect', x: 0, y: 40, w: 240, h: 40, rgb: [0x6f, 0x8f, 0xb0] }])
add('one eye hidden', WARM_LIGHT, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: [0xf1, 0xc9, 0xa5] }])
add('one eye hidden, a spot near the middle', WARM_LIGHT, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: [0xf1, 0xc9, 0xa5] }, { op: 'rect', x: 124, y: 146, w: 8, h: 8, rgb: [0x3a, 0x26, 0x18] }])
add('one eye smaller', WARM_LIGHT, [{ op: 'rect', x: 130, y: 142, w: 30, h: 6, rgb: [0xf1, 0xc9, 0xa5] }, { op: 'rect', x: 130, y: 154, w: 30, h: 6, rgb: [0xf1, 0xc9, 0xa5] }])
add('eyes off centre', COOL_LIGHT, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: [0xf0, 0xcf, 0xc8] }, { op: 'rect', x: 158, y: 146, w: 10, h: 8, rgb: [0x4f, 0x7a, 0xa8] }])
// Eyes on a face where they are found (the deep one): hidden, smaller,
// off centre, at different heights.
type RGB = [number, number, number]
const DEEP_SKIN: RGB = [0x8d, 0x5a, 0x34]
add('deep: one eye hidden', WARM_DEEP, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: DEEP_SKIN }])
add('deep: one eye smaller', WARM_DEEP, [{ op: 'rect', x: 130, y: 142, w: 30, h: 7, rgb: DEEP_SKIN }, { op: 'rect', x: 130, y: 153, w: 30, h: 7, rgb: DEEP_SKIN }])
add('deep: one eye a little smaller', WARM_DEEP, [{ op: 'rect', x: 130, y: 142, w: 30, h: 5, rgb: DEEP_SKIN }])
add('deep: one eye off centre', WARM_DEEP, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: DEEP_SKIN }, { op: 'rect', x: 152, y: 147, w: 9, h: 7, rgb: [0x2e, 0x1d, 0x10] }])
add('deep: one eye a little off centre', WARM_DEEP, [{ op: 'rect', x: 130, y: 142, w: 30, h: 18, rgb: DEEP_SKIN }, { op: 'rect', x: 146, y: 147, w: 9, h: 7, rgb: [0x2e, 0x1d, 0x10] }])
for (const offset of [0.03, 0.05, 0.07, 0.09]) add(`deep: eyes at heights apart ${offset}`, { ...WARM_DEEP, eyeOffset: offset })
for (const offset of [0.04, 0.06]) add(`cool deep: eyes at heights apart ${offset}`, { ...COOL_DEEP, eyeOffset: offset })
// Hair close to the skin; hair so noisy its lightness spreads.
for (const hair of ['#e2b994', '#dcb08c', '#e8c09c', '#d4a884']) add(`hair close to the skin ${hair}`, { ...WARM_LIGHT, hair })
for (const [noise, seed] of [[60, 5], [80, 6], [100, 8]]) add(`very noisy, ${noise}`, WARM_DEEP, [], noise, seed)
for (const [noise, seed] of [[60, 9], [90, 10]]) add(`very noisy light, ${noise}`, COOL_LIGHT, [], noise, seed)
// Skin in exactly two cells, under the central share; cells darker or
// lighter than the ones nearest the centre.
add('skin in two cells only', { width: 320, height: 320, skin: '#3a6ea5', hair: null, eyes: null }, [{ op: 'rect', x: 104, y: 100, w: 112, h: 30, rgb: [0xf1, 0xc9, 0xa5] }])
add('skin in two cells, a little more', { width: 320, height: 320, skin: '#3a6ea5', hair: null, eyes: null }, [{ op: 'rect', x: 104, y: 100, w: 112, h: 36, rgb: [0xf1, 0xc9, 0xa5] }])
for (const [rgb, name] of [[[0xe0, 0xb4, 0x94], 'a little darker'], [[0xd4, 0xa6, 0x84], 'darker'], [[0xc8, 0x98, 0x76], 'much darker']] as Array<[RGB, string]>) {
  add(`one cell ${name}`, WARM_LIGHT, [{ op: 'rect', x: 78, y: 96, w: 42, h: 64, rgb }])
  add(`the upper cells ${name}`, WARM_LIGHT, [{ op: 'rect', x: 78, y: 96, w: 84, h: 64, rgb }])
}
add('a shadow over half the face', WARM_LIGHT, [{ op: 'scale', num: 100, den: 100 }, { op: 'rect', x: 120, y: 110, w: 90, h: 120, rgb: [0xb8, 0x8a, 0x68] }])
add('a highlight over a quarter of the face', WARM_DEEP, [{ op: 'rect', x: 70, y: 120, w: 50, h: 60, rgb: [0xc8, 0x90, 0x68] }])

// Seeded variety around skin colours, hair, eyes and backgrounds.
{
  const rnd = lcg(2026)
  const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  const backgrounds = ['#6f8fb0', '#d8d8d0', '#3c4a3e', '#a0a8b8', '#f4f1ea', '#704030', '#202428']
  for (let i = 0; i < 40; i++) {
    const L = 0.25 + rnd() * 0.7
    const warm = rnd()
    const skin = hex(255 * L + 20, 255 * L * (0.72 + 0.12 * warm) + 5, 255 * L * (0.55 + 0.25 * (1 - warm)))
    const hairL = rnd()
    const hair = rnd() < 0.15 ? null : hex(30 + 200 * hairL, 20 + 160 * hairL * (0.7 + 0.3 * rnd()), 10 + 120 * hairL * rnd())
    const eyes = rnd() < 0.15 ? null : hex(40 + 60 * rnd(), 40 + 80 * rnd(), 30 + 140 * rnd())
    const w = 160 + Math.floor(rnd() * 161), h = 200 + Math.floor(rnd() * 121)
    cases.push({
      name: `seeded ${i + 1}`,
      spec: { width: w, height: h, skin, hair, eyes, background: backgrounds[Math.floor(rnd() * backgrounds.length)], faceScale: 0.6 + rnd() * 0.7 },
      noise: 6 + Math.floor(rnd() * 15),
      seed: 1 + Math.floor(rnd() * 100000),
      edits: [],
    })
  }
}

const labJSON = (l: Lab | null) => (l ? { L: l.L, a: l.a, b: l.b } : null)
const outcome = (f: () => unknown) => {
  try {
    return { value: f() }
  } catch (err) {
    if (err instanceof PhotoQualityError) return { error: 'photo_quality', reason: err.reason }
    if (err instanceof SkinNotVisibleError) return { error: 'skin_not_visible' }
    throw err
  }
}

const canvases: unknown[] = []
for (const c of cases) {
  const { data, info } = await sharp(Buffer.from(selfieSvg(c.spec))).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width > CANVAS_MAX_SIDE || info.height > CANVAS_MAX_SIDE || info.channels !== 3) throw new Error(`${c.name}: not a canvas`)
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()
  const canvas: Canvas = { width: info.width, height: info.height, data: new Uint8Array(data) }
  addNoise(canvas.data, c.noise, c.seed)
  for (const e of c.edits) applyEdit(canvas, e)
  canvases.push({
    name: c.name, png: png.toString('base64'), noise: c.noise, seed: c.seed, edits: c.edits,
    sha256: createHash('sha256').update(canvas.data).digest('hex'),
    quality: measureQuality(canvas),
    skin: outcome(() => {
      const s = measureSkin(canvas)
      return { ...s, lab: labJSON(s.lab) }
    }),
    result: outcome(() => analyzeCanvas(canvas)),
  })
}

// The pure steps on hand-picked values.
const rgbs: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], [241, 201, 165], [141, 90, 52], [240, 207, 200], [122, 80, 72], [59, 36, 22], [79, 122, 168], [128, 128, 128], [1, 2, 3], [10, 10, 10], [11, 11, 11], [254, 1, 128]]
const labs: Lab[] = [
  { L: 70, a: 10, b: 20 }, { L: 50, a: 18, b: 16 }, { L: 30, a: 2, b: 3 }, { L: 15, a: 1, b: 1 }, { L: 60, a: 3, b: 5 }, { L: 45, a: 25, b: 20 },
  { L: 56, a: 4, b: 6 }, { L: 30, a: -1, b: -8 }, { L: 50, a: -6, b: 10 }, { L: 45, a: 2, b: 3 }, { L: 20, a: 5, b: 5 }, { L: 39.9, a: 10, b: 10 },
  { L: 57.9, a: 10, b: 30 }, { L: 80, a: -2, b: -2 }, { L: 55, a: 2, b: 3 }, { L: 54.99, a: 2, b: 3 }, { L: 25, a: 1, b: -5 }, { L: 25.01, a: 1, b: -5 },
  { L: 40, a: -4, b: 5 }, { L: 40, a: -2, b: 5 }, { L: 40.01, a: 2, b: 2 }, { L: 54.9, a: 20, b: 15 }, { L: 21.99, a: 0, b: 0 }, { L: 22, a: 0, b: 0 },
]
const hues = [0, 40.99, 41, 46.99, 47, 50, 52.99, 53, 58.99, 59, 90, 359.9]
const lightness = [100, 68, 67.99, 57, 56.99, 45, 44.99, 0]
const features = [
  { warmth: 0.8, lightness: 0.6, chroma: 0.6, contrast: 0 }, { warmth: -0.8, lightness: 0.6, chroma: -0.6, contrast: -0.6 },
  { warmth: 0.8, lightness: -0.5, chroma: -0.4, contrast: 0 }, { warmth: -0.8, lightness: -0.4, chroma: 0.6, contrast: 0.8 },
  { warmth: null, lightness: 0.1, chroma: 0, contrast: null }, { warmth: 0, lightness: 0, chroma: 0, contrast: 0 },
  { warmth: 0.2, lightness: null as unknown as number, chroma: 0.1, contrast: null },
]
const pure = {
  rgbToLab: rgbs.map((rgb) => ({ rgb, lab: labJSON(rgbToLab(...rgb)), skin: isSkinPixel(...rgb) })),
  hue: labs.map((lab) => ({ lab, hue: hueAngle(lab), chroma: chroma(lab), hair: hairColorOf(lab), eyes: eyeColorOf(lab) })),
  undertone: hues.map((hue) => ({ hue, undertone: classifyUndertone(hue), margin: undertoneMargin(hue) })),
  skinTone: lightness.map((L) => ({ L, skinTone: classifySkinTone(L) })),
  contrast: [
    [labs[0], labs[2], labs[3]], [labs[0], null, labs[3]], [labs[0], labs[2], null], [labs[0], null, null], [labs[1], labs[4], labs[6]], [labs[4], labs[6], labs[9]],
  ].map(([skin, hair, eyes]) => ({ skin, hair, eyes, contrast: contrastOf(skin as Lab, hair, eyes) })),
  seasonFeatures: [
    [labs[0], true, labs[2], 40], [labs[1], false, null, null], [labs[5], true, null, 10], [labs[12], true, labs[13], 60],
  ].map(([skin, known, hair, contrast]) => ({ skin, undertoneKnown: known, hair, contrast, features: seasonFeatures(skin as Lab, known as boolean, hair as Lab | null, contrast as number | null) })),
  seasonProbabilities: features.filter((f) => f.lightness !== null).map((f) => ({ features: f, probabilities: seasonProbabilities(f) })),
  confidenceCap: [[true, true], [false, true], [true, false], [false, false]].map(([u, c]) => ({ undertoneKnown: u, contrastKnown: c, cap: confidenceCap(u, c) })),
  decideSeason: [
    [0.9, 1, 0.8], [0.5, 0.5, 0.8], [0.3, 1, 0.45], [0.6, 0.5, 0.65], [0.29, 1, 0.8], [0.35, 0.9, 0.8],
  ].map(([p, evidence, cap]) => {
    const probs: Array<{ season: Season; p: number }> = [{ season: 'winter', p }, { season: 'summer', p: (1 - p) * 0.6 }, { season: 'autumn', p: (1 - p) * 0.3 }, { season: 'spring', p: (1 - p) * 0.1 }]
    return { probabilities: probs, evidence, cap, decision: decideSeason(probs, evidence, cap) }
  }).concat(([[0.5, 0.48, 1, 0.45], [0.52, 0.46, 1, 0.8], [0.4, 0.39, 0.9, 0.65]] as Array<[number, number, number, number]>).map(([p1, p2, evidence, cap]) => {
    const probs: Array<{ season: Season; p: number }> = [{ season: 'autumn', p: p1 }, { season: 'spring', p: p2 }, { season: 'winter', p: (1 - p1 - p2) / 2 }, { season: 'summer', p: (1 - p1 - p2) / 2 }]
    return { probabilities: probs, evidence, cap, decision: decideSeason(probs, evidence, cap) }
  })),
}

writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-color.ts', sourceCommit: execSync('git rev-parse HEAD').toString().trim(),
      note: 'The selfie colour analysis as the Next.js code does it: synthetic canvases (PNG without noise, the noise and edits described) and the pure steps.',
      version: COLOR_ANALYSIS_VERSION, canvasMaxSide: CANVAS_MAX_SIDE,
      thresholds: { quality: QUALITY, skin: SKIN, undertone: UNDERTONE_BOUNDS, confidence: CONFIDENCE },
      prototypes: SEASON_PROTOTYPES, palettes: SEASONAL_PALETTES,
      canvases, ...pure,
    },
    null, 1,
  ) + '\n',
)
const tally: Record<string, number> = {}
for (const c of canvases as Array<{ result: { value?: { season: string | null }; error?: string; reason?: string } }>) {
  const k = c.result.error ? `${c.result.error}${c.result.reason ? ':' + c.result.reason : ''}` : `season:${c.result.value!.season}`
  tally[k] = (tally[k] ?? 0) + 1
}
console.log(`canvases: ${canvases.length}`, tally)
