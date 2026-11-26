/**
 * Golden vectors for the Go port of the development mock of garment
 * analysis (stage B4; src/lib/ai/mock-vision.ts). Parity strength
 * "behaviour": the Go resampler is not sharp's, so the 32×32 sample differs
 * by a little at the edges between colours; the pictures here are chosen so
 * that every decision (which colours, which thresholds) is far from its
 * boundary, and the detection must then be equal, confidences included.
 *
 * Writes pictures to apps/api/testdata/vision/ and what the real
 * analyzeClothing makes of them to apps/api/testdata/golden/vision.json.
 * (A picture with two colours of the same share is not here: which of them
 * comes first then depends on single pixels at their edge.)
 *
 *   cd apps/web && bun scripts/golden-vision.ts ../api/testdata
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp, { type OverlayOptions, type Sharp } from 'sharp'
import { analyzeClothing, COLORS } from '@/lib/ai/mock-vision'

const outDir = process.argv[2]
if (!outDir) throw new Error('usage: bun scripts/golden-vision.ts <apps/api/testdata>')
const visionDir = path.join(outDir, 'vision')
rmSync(visionDir, { recursive: true, force: true })
mkdirSync(visionDir, { recursive: true })

type RGB = [number, number, number]
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const bg = ([r, g, b]: RGB) => ({ r, g, b })

/** Vertical bands of the given widths (fractions of the width), left to right. */
async function bands(width: number, height: number, parts: Array<[RGB, number]>): Promise<Sharp> {
  const composite: OverlayOptions[] = []
  let left = 0
  for (const [color, share] of parts.slice(1)) {
    const w = Math.round(width * share)
    left = left === 0 ? Math.round(width * parts[0][1]) : left
    composite.push({ input: await sharp({ create: { width: w, height, channels: 3, background: bg(color) } }).png().toBuffer(), left, top: 0 })
    left += w
  }
  return sharp({ create: { width, height, channels: 3, background: bg(parts[0][0]) } }).composite(composite)
}

const WHITE: RGB = [245, 245, 245]
const NAVY: RGB = [30, 40, 80]
const RED: RGB = rgb(COLORS.find((c) => c.id === 'red')!.hex)
const BLACK: RGB = [17, 17, 17]

const pictures: Array<{ file: string; bytes: Buffer; about: string }> = []
const add = (file: string, bytes: Buffer, about: string) => pictures.push({ file, bytes, about })

// Every catalog colour as a solid picture, at its own value.
for (const c of COLORS) {
  add(`solid-${c.id}.png`, await sharp({ create: { width: 256, height: 256, channels: 3, background: bg(rgb(c.hex)) } }).png().toBuffer(), `solid ${c.id}`)
}
// The pictures the e2e specs upload.
add('e2e-white-shirt.png', await sharp({ create: { width: 512, height: 512, channels: 3, background: bg(WHITE) } }).png().toBuffer(), 'e2e: white shirt')
add('e2e-blue-jeans.png', await sharp({ create: { width: 512, height: 512, channels: 3, background: bg([40, 70, 150]) } }).png().toBuffer(), 'e2e: blue jeans')
add('e2e-navy-tee.png', await sharp({ create: { width: 512, height: 512, channels: 3, background: bg(NAVY) } }).png().toBuffer(), 'e2e: navy tee')
// Brightness on each side of its thresholds (50, 80, 200), far from them.
for (const v of [20, 65, 140, 225]) {
  add(`gray-${v}.jpg`, await sharp({ create: { width: 400, height: 300, channels: 3, background: bg([v, v, v]) } }).jpeg({ quality: 92 }).toBuffer(), `solid gray ${v}, JPEG`)
}
// Two colours: both count from 12 % of the picture.
add('white-60-navy-40.png', await (await bands(256, 256, [[WHITE, 0.6], [NAVY, 0.4]])).png().toBuffer(), '60 % white, 40 % navy')
add('red-70-black-30.png', await (await bands(256, 256, [[RED, 0.7], [BLACK, 0.3]])).png().toBuffer(), '70 % red, 30 % black')
add('navy-91-red-9.png', await (await bands(256, 256, [[NAVY, 0.91], [RED, 0.09]])).png().toBuffer(), '9 % red: under the threshold')
// The larger share comes first, wherever it is in the picture.
add('white-25-navy-75.png', await (await bands(256, 256, [[WHITE, 0.25], [NAVY, 0.75]])).png().toBuffer(), 'white at the left, 25 %')
// Dark, with enough white to name it: cotton, yet a cold season.
add('black-80-white-20.png', await (await bands(256, 256, [[BLACK, 0.8], [WHITE, 0.2]])).png().toBuffer(), '80 % black, 20 % white')
// Exactly as near navy as teal: the earlier colour of the catalog.
add('between-navy-and-teal.png', await sharp({ create: { width: 256, height: 256, channels: 3, background: bg([0, 63, 180]) } }).png().toBuffer(), 'a colour equally near two catalog colours')
add('navy-75-white-25.png', await (await bands(256, 256, [[NAVY, 0.75], [WHITE, 0.25]])).png().toBuffer(), '25 % white: over the threshold')
add('three-colours.png', await (await bands(256, 256, [[WHITE, 0.5], [RED, 0.3], [BLACK, 0.2]])).png().toBuffer(), '50/30/20: the two largest')
// Two near shades: neither solid nor striped by the uniformity thresholds.
add('two-grays.png', await (await bands(256, 256, [[[150, 150, 150], 0.6], [[200, 200, 200], 0.4]])).png().toBuffer(), 'two shades of gray, 60/40: colour block')
// The middle square is what is read: the band at the left edge is outside it.
add('wide-red-edge.png', await (await bands(768, 256, [[RED, 0.25], [WHITE, 0.75]])).png().toBuffer(), '768×256, red only outside the middle square')
add('tall-red-top.png', await (await bands(256, 768, [[WHITE, 1]])).composite([{ input: await sharp({ create: { width: 256, height: 190, channels: 3, background: bg(RED) } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer(), '256×768, red only above the middle square')
// Transparent pixels count as what is stored under them.
add('transparent-over-red.png', await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: RED[0], g: RED[1], b: RED[2], alpha: 1 } } }).png().toBuffer(), 'opaque red with an alpha channel')
add('lossless-navy.webp', await sharp({ create: { width: 300, height: 300, channels: 3, background: bg(NAVY) } }).webp({ lossless: true }).toBuffer(), 'WebP')

for (const p of pictures) writeFileSync(path.join(visionDir, p.file), p.bytes)

const detections: unknown[] = []
for (const p of pictures) {
  detections.push({ file: `vision/${p.file}`, about: p.about, filename: p.file, detection: await analyzeClothing({ buffer: p.bytes, filename: p.file }) })
}
// The file name is a hint for the category (and with it the subcategory).
const hintPicture = pictures.find((p) => p.file === 'e2e-white-shirt.png')!
const names = [
  'white-shirt.png', 'Futbolka.JPG', 'koylak.png', 'koylak-ayol.png', 'polo.webp', 'tee.jpg', 'blouse.png',
  'jacket.jpg', 'KURTKA.jpg', 'palto.png', 'blazer.png', 'ustki.png', 'windbreaker.jpg', 'raincoat.png',
  'blue-jeans.png', 'shim.jpg', 'chinos.png', 'trousers.png', 'shorts.png', 'pants.png',
  'dress.png', 'libos.png', 'white-sneaker.png', 'boots.jpg', 'loafer.png', 'shoe.png', 'oyqi.png',
  'sumka.jpg', 'tote.png', 'backpack.png', 'clutch.png', 'bag.png',
  'belt.png', 'scarf.png', 'hat.png', 'watch.png', 'sunglasses.png', 'accessory.png', 'sunset.jpg',
  'IMG_1234.jpg', '', 'photo', 'ŞHIRT.png', 'tshirt-and-jeans.png', 'jeans-shirt.png', 'that.png', 'chat.png',
]
const hints: unknown[] = []
for (const filename of names) {
  const d = await analyzeClothing({ buffer: hintPicture.bytes, filename })
  hints.push({ filename, category: d.category, subcategory: d.subcategory, categoryConfidence: d.confidence.category })
}

writeFileSync(
  path.join(outDir, 'golden', 'vision.json'),
  JSON.stringify({ source: 'apps/web/src/lib/ai/mock-vision.ts (analyzeClothing)', hintPicture: `vision/${hintPicture.file}`, detections, hints }, null, 2) + '\n',
)
console.log(`${pictures.length} pictures, ${detections.length} detections, ${hints.length} file names → ${outDir}`)
