/**
 * Golden vectors for the Go port of image processing (stage B4, ADR 0009).
 * Parity strength "behaviour": the Go encoders differ from sharp's, so the
 * bytes differ; what must be equal is the outcome (accepted, or which
 * refusal), the format kept for the master, the dimensions after
 * orientation, the variants' dimensions and formats, and where the pixels
 * end up (an orientation marker read from the display variant).
 *
 * Writes small fixtures to apps/api/testdata/images/ and their outcomes,
 * run through the real LocalStorageProvider.saveImage, to
 * apps/api/testdata/golden/images.json. Large images (sides and pixel
 * limits) are described, not stored: the Go test makes the same ones.
 *
 *   cd apps/web && bun scripts/golden-images.ts ../api/testdata
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'

const outDir = process.argv[2]
if (!outDir) throw new Error('usage: bun scripts/golden-images.ts <apps/api/testdata>')
const imagesDir = path.join(outDir, 'images')
mkdirSync(imagesDir, { recursive: true })

const storageDir = mkdtempSync(path.join(tmpdir(), 'golden-images-'))
process.env.STORAGE_LOCAL_DIR = storageDir
const { getStorageProvider, ImageDimensionsError, InvalidImageError, UnsupportedImageFormatError } = await import('@/lib/storage/provider')
const storage = getStorageProvider()

type RGB = { r: number; g: number; b: number }
const RED: RGB = { r: 220, g: 30, b: 30 }
const GREEN: RGB = { r: 30, g: 180, b: 60 }
const BLUE: RGB = { r: 30, g: 60, b: 220 }
const WHITE: RGB = { r: 245, g: 245, b: 245 }

/**
 * A 300×400 picture whose top-left quarter is red and whose top-right quarter
 * is green on white, so that the corner the red ends up in shows how the
 * picture was turned.
 */
async function marked(): Promise<Sharp> {
  const quarter = (c: RGB) => sharp({ create: { width: 150, height: 200, channels: 3, background: c } }).png().toBuffer()
  return sharp({ create: { width: 300, height: 400, channels: 3, background: WHITE } }).composite([
    { input: await quarter(RED), left: 0, top: 0 },
    { input: await quarter(GREEN), left: 150, top: 0 },
  ])
}

type Fixture = { file: string; bytes: Buffer; about: string; marked: boolean }
const fixtures: Fixture[] = []
const add = (file: string, bytes: Buffer, about: string) => fixtures.push({ file, bytes, about, marked: about !== '' && /orientation|marked|gps|progressive|no metadata|lossless/i.test(file + ' ' + about) })

for (let orientation = 1; orientation <= 8; orientation++) {
  add(`orientation-${orientation}.jpg`, await (await marked()).jpeg({ quality: 90 }).withMetadata({ orientation }).toBuffer(), `JPEG, EXIF orientation ${orientation}`)
}
add('orientation-6.webp', await (await marked()).webp({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer(), 'WebP with EXIF orientation 6')
add('orientation-6.png', await (await marked()).png().withMetadata({ orientation: 6 }).toBuffer(), 'PNG with EXIF orientation 6 (eXIf chunk)')
add('marked.png', await (await marked()).png().toBuffer(), 'PNG, no metadata')
add('marked-lossless.webp', await (await marked()).webp({ lossless: true }).toBuffer(), 'WebP lossless')
add('marked-progressive.jpg', await (await marked()).jpeg({ progressive: true }).toBuffer(), 'progressive JPEG')
add('alpha.png', await sharp({ create: { width: 300, height: 300, channels: 4, background: { ...BLUE, alpha: 0.5 } } }).png().toBuffer(), 'PNG with alpha')
add('alpha.webp', await sharp({ create: { width: 300, height: 300, channels: 4, background: { ...BLUE, alpha: 0.5 } } }).webp().toBuffer(), 'WebP with alpha')
add('gray.png', await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 } } }).toColourspace('b-w').png().toBuffer(), 'grey PNG')
add('deep.png', await sharp({ create: { width: 300, height: 300, channels: 3, background: GREEN } }).toColourspace('rgb16').png().toBuffer(), '16-bit PNG')
// Differences from sharp that the Go test names (ADR 0009): a 16-bit picture
// that is turned is written with 8 bits per channel, and an animated WebP is
// refused (sharp takes its first frame).
add('deep-turned.png', await sharp({ create: { width: 300, height: 400, channels: 3, background: GREEN } }).toColourspace('rgb16').png().withMetadata({ orientation: 6 }).toBuffer(), '16-bit PNG with EXIF orientation 6')
add(
  'animated.webp',
  await sharp(Buffer.concat([Buffer.alloc(300 * 300 * 3, 200), Buffer.alloc(300 * 300 * 3, 40)]), { raw: { width: 300, height: 600, channels: 3, pageHeight: 300 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer(),
  'animated WebP, two frames',
)
add('gps.jpg', await (await marked()).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-owner', ImageDescription: 'home of the user' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 0/1' } } }).toBuffer(), 'JPEG with EXIF text and GPS')
add('tiny.png', await sharp({ create: { width: 255, height: 400, channels: 3, background: RED } }).png().toBuffer(), 'shortest side 255')
add('min.png', await sharp({ create: { width: 256, height: 256, channels: 3, background: RED } }).png().toBuffer(), 'shortest side 256')
add('tiny-turned.jpg', await sharp({ create: { width: 400, height: 255, channels: 3, background: RED } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(), '400×255 turned to 255×400')
add('picture.gif', await sharp({ create: { width: 300, height: 300, channels: 3, background: RED } }).gif().toBuffer(), 'GIF')
add('picture.tif', await sharp({ create: { width: 300, height: 300, channels: 3, background: RED } }).tiff().toBuffer(), 'TIFF')
add('picture.avif', await sharp({ create: { width: 300, height: 300, channels: 3, background: RED } }).avif().toBuffer(), 'AVIF')
add('picture.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="red"/></svg>'), 'SVG')
add('heic-brand.bin', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]), 'HEIC container header only')
add('garbage.bin', Buffer.from('this is not an image at all, just text bytes '.repeat(20)), 'not an image')
const jpeg = await (await marked()).jpeg().toBuffer()
add('truncated.jpg', jpeg.subarray(0, Math.floor(jpeg.length / 2)), 'JPEG cut in half')
add('empty.bin', Buffer.alloc(0), 'no bytes')

/** Large images, described: made by both tests (solid red PNG). */
const generated = [
  { width: 8000, height: 300 },
  { width: 8001, height: 300 },
  { width: 6400, height: 6250 }, // 40 000 000 pixels
  { width: 6400, height: 6251 }, // one row more
  // The thumbnail's size comes from the picture's own, not from the display variant's.
  { width: 2000, height: 402 },
  { width: 1002, height: 2000 },
]

function outcomeOf(err: unknown) {
  if (err instanceof UnsupportedImageFormatError) return 'UNSUPPORTED_IMAGE_FORMAT'
  if (err instanceof ImageDimensionsError) return 'IMAGE_DIMENSIONS'
  if (err instanceof InvalidImageError) return 'INVALID_IMAGE'
  throw err
}

/** Where the red quarter ended up in the display variant: which corner of a 2×2 grid is reddest. */
async function redCorner(key: string): Promise<string> {
  const { data, info } = await sharp(readFileSync(path.join(storageDir, key))).resize(2, 2, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let best = -1
  let corner = ''
  for (const [i, name] of ['top-left', 'top-right', 'bottom-left', 'bottom-right'].entries()) {
    const [r, g, b] = data.subarray(i * info.channels, i * info.channels + 3)
    const redness = r - (g + b) / 2
    if (redness > best) {
      best = redness
      corner = name
    }
  }
  return corner
}

async function run(bytes: Buffer, marked = false) {
  try {
    const s = await storage.saveImage(bytes, 'golden')
    const meta = async (key: string) => {
      const m = await sharp(readFileSync(path.join(storageDir, key))).metadata()
      return { format: m.format, width: m.width, height: m.height, exif: !!m.exif, icc: !!m.icc, xmp: !!m.xmp }
    }
    return {
      outcome: 'ok',
      width: s.width,
      height: s.height,
      mimeType: s.mimeType,
      master: { ext: path.extname(s.key).slice(1), ...(await meta(s.key)) },
      display: await meta(s.displayKey),
      thumbnail: await meta(s.thumbnailKey),
      // Only pictures with the red quarter have a corner to find.
      redCorner: marked ? await redCorner(s.displayKey) : undefined,
    }
  } catch (err) {
    return { outcome: outcomeOf(err) }
  }
}

const results: unknown[] = []
for (const f of fixtures) {
  writeFileSync(path.join(imagesDir, f.file), f.bytes)
  results.push({ file: f.file, about: f.about, ...(await run(f.bytes, f.marked)) })
}
const large: unknown[] = []
for (const g of generated) {
  const bytes = await sharp({ create: { width: g.width, height: g.height, channels: 3, background: RED }, limitInputPixels: false }).png().toBuffer()
  const r = (await run(bytes)) as { outcome: string; width?: number; height?: number; display?: unknown; thumbnail?: unknown }
  large.push({ ...g, outcome: r.outcome, display: r.display, thumbnail: r.thumbnail })
}
rmSync(storageDir, { recursive: true, force: true })

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(
  path.join(outDir, 'golden', 'images.json'),
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-images.ts',
      sourceCommit,
      note: 'fixtures: files in testdata/images, through LocalStorageProvider.saveImage. large: solid red PNGs of the given size, made by each test. redCorner: the corner of the display variant the red quarter (top-left in the unturned picture) is in.',
      fixtures: results,
      large,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${results.length} fixtures and ${large.length} large cases`)
