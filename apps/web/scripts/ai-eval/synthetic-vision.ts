/**
 * Synthetic clothing-vision dataset (Phase 4.5) for scripts/ai-eval/vision-eval.ts.
 *
 *   bun scripts/ai-eval/synthetic-vision.ts --out=<dir outside the repo>
 *   bun scripts/ai-eval/vision-eval.ts --dataset=<that dir> --matrix=<matrix> --out=<results dir>
 *
 * Drawn silhouettes (SVG → PNG), no photos of people, no real data. They
 * exercise the contract end to end — schema validity, category and colour on
 * clean shapes, single-garment detection, rejection of non-garments, multiple
 * garments, ambiguous and poor-quality images — but they are NOT a substitute
 * for real, consented garment photos when judging production accuracy.
 */
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { Dataset } from './vision-scoring'
import { arg, assertOutsideRepo } from './eval-common'

type Expected = Dataset['items'][number]['expected']
export interface SyntheticImage {
  id: string
  file: string
  expected: Expected
  svg: string
  /** Post-processing that degrades the image (poor-quality cases). */
  degrade?: 'tiny' | 'blur'
}

const W = 600, H = 800
const svg = (body: string, bg = '#f2f2f2') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`

const tee = (fill: string, x = 0, s = 1) => `<g transform="translate(${x} 0) scale(${s})"><path d="M200 160 L120 200 L80 300 L150 330 L170 280 L170 640 L430 640 L430 280 L450 330 L520 300 L480 200 L400 160 Q300 220 200 160 Z" fill="${fill}" stroke="#333" stroke-width="3"/></g>`
const shirt = (fill: string) =>
  `<path d="M200 150 L110 190 L60 560 L120 575 L170 300 L170 660 L430 660 L430 300 L480 575 L540 560 L490 190 L400 150 L340 200 L300 170 L260 200 Z" fill="${fill}" stroke="#333" stroke-width="3"/>` +
  `<path d="M260 200 L300 260 L340 200" fill="none" stroke="#333" stroke-width="3"/>` +
  [300, 360, 420, 480, 540, 600].map((y) => `<circle cx="300" cy="${y}" r="6" fill="#ddd" stroke="#333"/>`).join('')
const jacket = (fill: string, long = false) =>
  `<path d="M190 140 L100 190 L50 ${long ? 620 : 560} L115 ${long ? 635 : 575} L165 300 L160 ${long ? 760 : 620} L440 ${long ? 760 : 620} L435 300 L485 ${long ? 635 : 575} L550 ${long ? 620 : 560} L500 190 L410 140 L300 230 Z" fill="${fill}" stroke="#222" stroke-width="3"/>` +
  `<line x1="300" y1="230" x2="300" y2="${long ? 760 : 620}" stroke="#111" stroke-width="4"/>` +
  `<path d="M190 140 L250 300 L300 230 L350 300 L410 140" fill="none" stroke="#111" stroke-width="3"/>`
const trousers = (fill: string, seams = false) =>
  `<path d="M180 100 L420 100 L450 740 L330 740 L300 300 L270 740 L150 740 Z" fill="${fill}" stroke="#222" stroke-width="3"/>` +
  (seams ? `<path d="M200 140 Q240 190 280 140 M320 140 Q360 190 400 140" fill="none" stroke="#e0b060" stroke-width="3"/>` : '')
const dress = (fill: string) => `<path d="M240 110 L360 110 L380 300 L470 740 L130 740 L220 300 Z" fill="${fill}" stroke="#333" stroke-width="3"/><path d="M240 110 L210 80 M360 110 L390 80" stroke="#333" stroke-width="6"/>`
const shoes = (fill: string) =>
  [140, 330].map((x) => `<path d="M${x} 420 L${x + 40} 360 L${x + 90} 360 L${x + 110} 430 L${x + 170} 450 L${x + 170} 490 L${x} 490 Z" fill="${fill}" stroke="#222" stroke-width="3"/><rect x="${x}" y="490" width="170" height="16" fill="#fafafa" stroke="#222"/>`).join('')
const belt = (fill: string) => `<rect x="60" y="370" width="480" height="60" rx="10" fill="${fill}" stroke="#222" stroke-width="3"/><rect x="420" y="360" width="80" height="80" fill="none" stroke="#c0a040" stroke-width="10"/>`

export function syntheticVisionItems(): SyntheticImage[] {
  return [
    { id: 'tshirt_white', file: 'tshirt_white.png', svg: svg(tee('#fdfdfd'), '#cfd8dc'), expected: { subject: 'single_garment', category: 'shirt', subcategory: 'tshirt', primaryColor: 'white', sleeveLength: 'short' } },
    { id: 'tshirt_red', file: 'tshirt_red.png', svg: svg(tee('#c62828')), expected: { subject: 'single_garment', category: 'shirt', subcategory: 'tshirt', primaryColor: 'red', sleeveLength: 'short' } },
    { id: 'shirt_lightblue', file: 'shirt_lightblue.png', svg: svg(shirt('#9ec9ef')), expected: { subject: 'single_garment', category: 'shirt', primaryColor: 'light_blue', sleeveLength: 'long' } },
    { id: 'jacket_black', file: 'jacket_black.png', svg: svg(jacket('#1c1c1c')), expected: { subject: 'single_garment', category: 'outerwear', primaryColor: 'black' } },
    { id: 'coat_camel', file: 'coat_camel.png', svg: svg(jacket('#b5835a', true)), expected: { subject: 'single_garment', category: 'outerwear', subcategory: 'coat', primaryColor: 'brown' } },
    { id: 'trousers_navy', file: 'trousers_navy.png', svg: svg(trousers('#1f2a44')), expected: { subject: 'single_garment', category: 'pants', primaryColor: 'navy' } },
    { id: 'jeans_blue', file: 'jeans_blue.png', svg: svg(trousers('#3a6ea5', true)), expected: { subject: 'single_garment', category: 'pants', subcategory: 'jeans', primaryColor: 'blue' } },
    { id: 'dress_burgundy', file: 'dress_burgundy.png', svg: svg(dress('#7b1f2e')), expected: { subject: 'single_garment', category: 'dress', primaryColor: 'burgundy' } },
    { id: 'shoes_white', file: 'shoes_white.png', svg: svg(shoes('#fafafa'), '#90a4ae'), expected: { subject: 'single_garment', category: 'shoes', primaryColor: 'white' } },
    { id: 'belt_brown', file: 'belt_brown.png', svg: svg(belt('#6d4c41')), expected: { subject: 'single_garment', category: 'accessory', subcategory: 'belt', primaryColor: 'brown' } },
    // Policy cases: the app should refuse rather than guess.
    { id: 'ambiguous_blob', file: 'ambiguous_blob.png', svg: svg('<ellipse cx="300" cy="400" rx="220" ry="160" fill="#8d6e63"/><ellipse cx="260" cy="380" rx="90" ry="70" fill="#a1887f"/>'), expected: { subject: 'unclear' } },
    { id: 'multiple_garments', file: 'multiple_garments.png', svg: svg(`${tee('#2e7d32', -20, 0.6)}<g transform="translate(330 120) scale(0.45)">${trousers('#1f2a44')}</g>`), expected: { subject: 'multiple_garments' } },
    { id: 'no_garment_landscape', file: 'no_garment_landscape.png', svg: svg('<rect y="480" width="600" height="320" fill="#6b8e23"/><circle cx="450" cy="160" r="70" fill="#ffd54f"/><path d="M0 480 L180 300 L330 480 Z" fill="#78909c"/>', '#81d4fa'), expected: { subject: 'no_garment' } },
    { id: 'poor_quality_tiny', file: 'poor_quality_tiny.png', svg: svg(tee('#c62828')), degrade: 'tiny', expected: { subject: 'unclear' } },
    { id: 'poor_quality_blur', file: 'poor_quality_blur.png', svg: svg(shirt('#9ec9ef')), degrade: 'blur', expected: { subject: 'unclear' } },
  ]
}

/** Renders one synthetic image (PNG bytes). Deterministic. */
export async function renderSynthetic(item: SyntheticImage): Promise<Buffer> {
  const base = sharp(Buffer.from(item.svg))
  if (item.degrade === 'tiny') {
    const small = await base.resize(18, 24).jpeg({ quality: 10 }).toBuffer()
    return sharp(small).resize(W, H, { kernel: 'nearest' }).png().toBuffer()
  }
  if (item.degrade === 'blur') return base.blur(40).png().toBuffer()
  return base.png().toBuffer()
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const items = syntheticVisionItems()
  await fs.mkdir(outDir, { recursive: true })
  for (const item of items) await fs.writeFile(path.join(outDir, item.file), await renderSynthetic(item))
  const labels = Dataset.parse({ items: items.map(({ id, file, expected }) => ({ id, file, expected })) })
  await fs.writeFile(path.join(outDir, 'labels.json'), JSON.stringify(labels, null, 2) + '\n')
  console.log(`wrote ${items.length} synthetic images and labels.json to ${outDir}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
