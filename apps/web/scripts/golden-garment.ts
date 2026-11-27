/**
 * Golden vectors of garment analysis with a real provider, for the Go backend
 * (stage B6): the instruction and the schema the model is given, what
 * interpretGarmentOutput makes of an answer, the confidences shown, the
 * colour cross-check and the blur measure (src/lib/ai/garment-analysis.ts,
 * color-check.ts, garment-quality.ts, color-analysis.ts).
 *
 * The pictures of the colour vectors are 80×80 PNGs: their centre is exactly
 * the 48×48 pixels the check samples, so no resampling is involved.
 *
 *   bun scripts/golden-garment.ts ../api/testdata/golden/garment.json
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { COLORS } from '../src/lib/ai/catalog'
import { measureQuality, type Canvas } from '../src/lib/ai/color-analysis'
import { centerColorShares, COLOR_FAMILIES, CONFLICT_MAX_CONFIDENCE, judgeColor, WEAK_SUPPORT_MAX_CONFIDENCE } from '../src/lib/ai/color-check'
import {
  CONFIDENCE_KEYS, GARMENT_INSTRUCTION, GARMENT_JSON_SCHEMA, GARMENT_MAX_OUTPUT_TOKENS, interpretGarmentOutput, presentConfidences,
  UNCALIBRATED_MAX_CONFIDENCE, VISION_ANALYSIS_VERSION, type GarmentConfidences,
} from '../src/lib/ai/garment-analysis'
import { GARMENT_MIN_SHARPNESS } from '../src/lib/ai/garment-quality'

// A generator with a fixed seed: the vectors are the same on every run.
let seed = 20261127
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const int = (n: number) => Math.floor(random() * n)

// ── What is made of a model's answer ─────────────────────────────────────────
const confidence = (v = 0.9): GarmentConfidences => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v])) as GarmentConfidences
const garment = {
  subject: 'single_garment', category: 'shirt', subcategory: 'tshirt', colors: ['white', 'navy'], pattern: 'solid', material: 'cotton',
  sleeveLength: 'short', fit: 'regular', style: 'casual', season: ['spring', 'summer'], gender: 'unisex', formality: 'casual', confidence: confidence(),
}
const rejected = (subject: string) => ({
  subject, category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null, style: null, season: [],
  gender: null, formality: null, confidence: confidence(0),
})
const without = (key: string) => Object.fromEntries(Object.entries(garment).filter(([k]) => k !== key))
const outputs: [string, unknown][] = [
  ['a garment, every attribute', garment],
  ['a garment with only a category', { ...rejected('single_garment'), category: 'bag' }],
  ['a garment without a subcategory', { ...garment, subcategory: null }],
  ['a garment without colours or seasons', { ...garment, colors: [], season: [] }],
  ['five colours, four seasons', { ...garment, colors: ['white', 'navy', 'red', 'black', 'gray'], season: ['spring', 'summer', 'autumn', 'winter'] }],
  ['confidences at the ends', { ...garment, confidence: { ...confidence(0), category: 1, color: 0.123456789 } }],
  ['confidences written as 1e-3 and 1.0', JSON.parse(JSON.stringify({ ...garment, confidence: confidence(0.5) }).replace('"category":0.5', '"category":1e-3').replace('"color":0.5', '"color":1.0'))],
  ['several garments', rejected('multiple_garments')],
  ['no garment', rejected('no_garment')],
  ['unclear', rejected('unclear')],
  ['not a garment, with attributes left in', { ...garment, subject: 'no_garment' }],
  ['a single garment without a category', { ...garment, category: null }],
  ['a single garment without a category or a subcategory', { ...garment, category: null, subcategory: null }],
  ['a subcategory of another category', { ...garment, category: 'pants', subcategory: 'tshirt' }],
  ['a subject that is not one of the four', { ...garment, subject: 'person' }],
  ['a subject of another case', { ...garment, subject: 'Single_Garment' }],
  ['a category that is not in the catalog', { ...garment, category: 'jewelry' }],
  ['a subcategory that is not in the catalog', { ...garment, subcategory: 'kimono' }],
  ['a colour that is not in the catalog', { ...garment, colors: ['white', 'turquoise'] }],
  ['a colour twice', { ...garment, colors: ['white', 'navy', 'white'] }],
  ['six colours', { ...garment, colors: ['white', 'navy', 'red', 'black', 'gray', 'blue'] }],
  ['a season twice', { ...garment, season: ['summer', 'summer'] }],
  ['five seasons', { ...garment, season: ['spring', 'summer', 'autumn', 'winter', 'spring'] }],
  ['a season that is not one', { ...garment, season: ['monsoon'] }],
  ['colours that are no list', { ...garment, colors: 'white' }],
  ['colours that are null', { ...garment, colors: null }],
  ['a colour that is no text', { ...garment, colors: ['white', 5] }],
  ['a pattern that is not in the catalog', { ...garment, pattern: 'zebra' }],
  ['a material that is a number', { ...garment, material: 3 }],
  ['a fit that is an empty text', { ...garment, fit: '' }],
  ['a gender that is a list', { ...garment, gender: ['male'] }],
  ['a confidence above one', { ...garment, confidence: { ...confidence(), color: 1.01 } }],
  ['a confidence below zero', { ...garment, confidence: { ...confidence(), fit: -0.01 } }],
  ['a confidence that is text', { ...garment, confidence: { ...confidence(), fit: '0.9' } }],
  ['a confidence that is null', { ...garment, confidence: { ...confidence(), fit: null } }],
  ['a confidence that is missing', { ...garment, confidence: Object.fromEntries(Object.entries(confidence()).filter(([k]) => k !== 'gender')) }],
  ['a confidence too many', { ...garment, confidence: { ...confidence(), colors: 0.5 } }],
  ['confidences that are a number', { ...garment, confidence: 0.9 }],
  ['confidences that are null', { ...garment, confidence: null }],
  ['a field too many', { ...garment, brand: 'Acme' }],
  ['a field too many in a rejection', { ...rejected('no_garment'), note: 'a person' }],
  ['a field of another case', { ...without('sleeveLength'), sleevelength: 'short' }],
  ...Object.keys(garment).map((key): [string, unknown] => [`without ${key}`, without(key)]),
  ['an empty object', {}],
  ['a list', [garment]],
  ['a text', JSON.stringify(garment)],
  ['null', null],
  ['a number', 7],
  ['true', true],
]
const interpreted = outputs.map(([name, output]) => {
  try {
    return { name, output, result: interpretGarmentOutput(output) }
  } catch (err) {
    return { name, output, error: (err as Error).message }
  }
})

// ── The confidences shown ───────────────────────────────────────────────────
const presented = [
  { raw: confidence(0.9), cap: null },
  { raw: confidence(0.9), cap: WEAK_SUPPORT_MAX_CONFIDENCE },
  { raw: confidence(0.9), cap: CONFLICT_MAX_CONFIDENCE },
  { raw: confidence(0.2), cap: CONFLICT_MAX_CONFIDENCE },
  { raw: confidence(0), cap: null },
  { raw: confidence(1), cap: null },
  { raw: { ...confidence(0.685), color: 0.345, fit: 0.695, style: 0.125, season: 0.005, gender: 0.004999 }, cap: null },
  { raw: { ...confidence(0.61), color: 0.605 }, cap: WEAK_SUPPORT_MAX_CONFIDENCE },
  ...Array.from({ length: 12 }, (_, i) => ({ raw: Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, Math.round(random() * 1e4) / 1e4])) as GarmentConfidences, cap: [null, WEAK_SUPPORT_MAX_CONFIDENCE, CONFLICT_MAX_CONFIDENCE][i % 3] })),
].map((c) => ({ ...c, shown: presentConfidences(c.raw, c.cap) }))

// ── The colour cross-check ──────────────────────────────────────────────────
const judged = [
  { primary: null, shares: {} },
  { primary: null, shares: { white: 1 } },
  { primary: 'white', shares: {} },
  { primary: 'white', shares: { white: 0.15 } },
  { primary: 'white', shares: { white: 0.1499 } },
  { primary: 'white', shares: { white: 0.05 } },
  { primary: 'white', shares: { white: 0.0499 } },
  { primary: 'white', shares: { cream: 0.05, ivory: 0.05, gray: 0.05 } },
  { primary: 'white', shares: { cream: 0.02, ivory: 0.02, gray: 0.02, navy: 0.94 } },
  { primary: 'navy', shares: { red: 0.97, black: 0.03 } },
  { primary: 'navy', shares: { red: 1 } },
  { primary: 'turquoise', shares: { turquoise: 0.5 } },
  { primary: 'turquoise', shares: { teal: 0.5 } },
  ...COLORS.map((c) => ({ primary: c.id, shares: Object.fromEntries(COLORS.map((o) => [o.id, 1 / COLORS.length])) })),
  ...COLORS.map((c) => ({ primary: c.id, shares: Object.fromEntries(COLORS.filter(() => random() < 0.4).map((o) => [o.id, Math.round(random() * 100) / 1000])) })),
].map((c) => ({ ...c, check: judgeColor(c.primary ?? undefined, new Map(Object.entries(c.shares))) }))

const picture = async (name: string, at: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(80 * 80 * 3)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) data.set(at(x, y), (y * 80 + x) * 3)
  const png = await sharp(data, { raw: { width: 80, height: 80, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()
  return { name, png: png.toString('base64'), shares: Object.fromEntries(await centerColorShares(png)) }
}
const hex = (id: string) => {
  const h = COLORS.find((c) => c.id === id)!.hex
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
const noise = Array.from({ length: 48 }, () => [int(256), int(256), int(256)] as [number, number, number])
const shared = [
  await picture('one colour', () => hex('navy')),
  await picture('a red centre in a white border', (x, y) => (x >= 16 && x < 64 && y >= 16 && y < 64 ? hex('red') : hex('white'))),
  await picture('the border reaches one pixel into the centre', (x, y) => (x >= 17 && x < 64 && y >= 16 && y < 64 ? hex('red') : hex('white'))),
  await picture('every catalog colour in stripes', (x) => hex(COLORS[x % COLORS.length].id)),
  await picture('colours between the catalog colours', (x, y) => [(x * 3) % 256, (y * 3) % 256, ((x + y) * 2) % 256]),
  await picture('48 random colours in blocks', (x, y) => noise[(Math.floor(x / 10) * 8 + Math.floor(y / 10)) % 48]),
  await picture('grays from black to white', (x) => [x * 3, x * 3, x * 3]),
]

// ── The blur measure ────────────────────────────────────────────────────────
const canvas = (name: string, width: number, height: number, at: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 3)
  const c: Canvas = { width, height, data }
  return { name, width, height, rgb: Buffer.from(data).toString('base64'), sharpness: measureQuality(c).sharpness }
}
const sharpness = [
  canvas('one pixel', 1, 1, () => [200, 100, 50]),
  canvas('two by two', 2, 2, (x, y) => [x * 255, y * 255, 0]),
  canvas('three by three, one interior pixel', 3, 3, (x, y) => (x === 1 && y === 1 ? [255, 255, 255] : [0, 0, 0])),
  canvas('a row', 40, 1, (x) => [x * 6, 0, 0]),
  canvas('a flat picture', 32, 24, () => [120, 130, 140]),
  canvas('a smooth gradient', 32, 24, (x, y) => [x * 4, y * 4, 128]),
  canvas('a checkerboard', 32, 24, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])),
  canvas('stripes four pixels wide', 32, 24, (x) => (Math.floor(x / 4) % 2 ? [220, 220, 220] : [30, 30, 30])),
  canvas('noise', 40, 30, () => [int(256), int(256), int(256)]),
  canvas('faint noise', 40, 30, () => { const v = 120 + int(9); return [v, v, v] }),
  canvas('noise a little under the threshold', 40, 30, () => { const v = 120 + int(3); return [v, v, v] }),
  canvas('noise a little over the threshold', 40, 30, () => { const v = 120 + int(5); return [v, v, v] }),
  canvas('coloured noise', 64, 48, () => [100 + int(60), 80 + int(90), int(256)]),
]

const all = { interpreted, presented, judged, shared, sharpness }
writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-garment.ts', sourceCommit: execSync('git rev-parse HEAD').toString().trim(),
      note: 'Garment analysis with a real provider, as the Next.js code does it: instruction, schema, validation, shown confidences, colour cross-check, blur measure.',
      version: VISION_ANALYSIS_VERSION, instruction: GARMENT_INSTRUCTION, schema: JSON.stringify(GARMENT_JSON_SCHEMA), maxOutputTokens: GARMENT_MAX_OUTPUT_TOKENS,
      confidenceKeys: CONFIDENCE_KEYS, uncalibratedMaxConfidence: UNCALIBRATED_MAX_CONFIDENCE, minSharpness: GARMENT_MIN_SHARPNESS, families: COLOR_FAMILIES, ...all,
    },
    null, 1,
  ) + '\n',
)
console.log(Object.entries(all).map(([k, v]) => `${k}: ${v.length}`).join(', '))
