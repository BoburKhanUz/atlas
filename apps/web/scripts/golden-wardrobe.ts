/**
 * Golden vectors for the Go port of the wardrobe item routes (stage B4,
 * parity strength "exact"):
 *   - corrections: a stored item and a PATCH body (parsed by the real
 *     WardrobeItemPatchRequest) → the subcategory check, the logged
 *     corrections in their order, and the column values written;
 *   - serialized: stored rows → serializeWardrobeItem as JSON text, with a
 *     fixed signing secret (used nowhere else) and a fixed clock.
 *
 *   cd apps/web && bun scripts/golden-wardrobe.ts ../api/testdata/golden/wardrobe.json
 */
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-wardrobe.ts <output.json>')

process.env.MEDIA_SIGNING_SECRET = 'golden-wardrobe-secret-golden-wardrobe-secret'
const NOW = Date.UTC(2026, 10, 26, 9, 30, 15, 42)
Date.now = () => NOW

const { WardrobeItemPatchRequest } = await import('@/server/schemas/requests')
const { computeCorrections, subcategoryMismatch } = await import('@/lib/wardrobe/corrections')
const { serializeWardrobeItem } = await import('@/lib/wardrobe/serialize')

const AT = '2026-11-26T09:30:15.042Z'

const shirt = {
  category: 'shirt',
  subcategory: 'tshirt',
  colors: '["white","navy"]',
  pattern: 'solid',
  material: 'cotton',
  sleeveLength: 'short',
  fit: 'regular',
  style: 'casual',
  season: '["spring","summer"]',
  gender: 'unisex',
  formality: 'casual',
}
const bare = {
  category: 'shoes',
  subcategory: null,
  colors: '[]',
  pattern: null,
  material: null,
  sleeveLength: null,
  fit: null,
  style: null,
  season: '[]',
  gender: null,
  formality: null,
}

const bodies: Array<{ name: string; current: typeof shirt | typeof bare; body: unknown }> = [
  { name: 'empty', current: shirt, body: {} },
  { name: 'every field the same', current: shirt, body: { ...shirt, colors: ['white', 'navy'], season: ['spring', 'summer'] } },
  { name: 'one colour more', current: shirt, body: { colors: ['white', 'navy', 'red'] } },
  { name: 'colours reordered', current: shirt, body: { colors: ['navy', 'white'] } },
  { name: 'colours cleared', current: shirt, body: { colors: [] } },
  { name: 'season set', current: bare, body: { season: ['winter'] } },
  { name: 'pattern cleared', current: shirt, body: { pattern: null } },
  { name: 'null over null', current: bare, body: { pattern: null, fit: null } },
  { name: 'set from null', current: bare, body: { material: 'leather', gender: 'female' } },
  { name: 'members in reverse order', current: shirt, body: { formality: 'formal', gender: 'male', style: 'formal', fit: 'slim', sleeveLength: 'long', material: 'linen', pattern: 'striped', season: ['autumn'], colors: ['black'], subcategory: 'oxford_shirt', category: 'shirt' } },
  { name: 'category and fitting subcategory', current: shirt, body: { category: 'pants', subcategory: 'jeans' } },
  { name: 'category alone, subcategory stale', current: shirt, body: { category: 'pants' } },
  { name: 'category alone, no subcategory', current: bare, body: { category: 'shirt' } },
  { name: 'subcategory alone, fits', current: shirt, body: { subcategory: 'oxford_shirt' } },
  { name: 'subcategory alone, of another category', current: shirt, body: { subcategory: 'jeans' } },
  { name: 'subcategory cleared with another category', current: shirt, body: { category: 'pants', subcategory: null } },
  { name: 'category the same, subcategory stale', current: shirt, body: { category: 'shirt', subcategory: 'sneakers' } },
  // A pair stored before the rule existed is not judged by a correction of something else.
  { name: 'stale stored pair, another field', current: { ...shirt, subcategory: 'jeans' }, body: { fit: 'slim' } },
  { name: 'stale stored pair, category named again', current: { ...shirt, subcategory: 'jeans' }, body: { category: 'shirt' } },
  // A value from an older version, with characters JSON may escape.
  { name: 'legacy value with markup characters', current: { ...shirt, pattern: 'a<b&c>"d' }, body: { pattern: 'solid' } },
  { name: 'season the same, colours differ', current: shirt, body: { season: ['spring', 'summer'], colors: ['white'] } },
]

/** The log every correction case starts with: an entry kept as it is stored. */
const EXISTING_LOG = '[{"field":"fit","from":"slim","to":"regular","at":"2026-01-01T00:00:00.000Z","extra":"kept"}]'

const corrections = bodies.map(({ name, current, body }) => {
  const data = WardrobeItemPatchRequest.parse(body)
  const mismatch = subcategoryMismatch(current as never, data)
  const { corrections: logged, update } = computeCorrections(current as never, data, AT)
  // What the route stores (route.ts): the old entries, then the new ones.
  const storedLog = logged.length > 0 && !mismatch ? JSON.stringify([...JSON.parse(EXISTING_LOG), ...logged]) : null
  return { name, current, body, mismatch, corrections: logged, update, storedLog }
})

const KEY = 'users/cgolden1/0f8fad5b-d9cb-469f-a165-70867728950e'
const created = new Date(Date.UTC(2026, 10, 20, 7, 0, 0, 0))
const updated = new Date(Date.UTC(2026, 10, 25, 18, 45, 3, 7))
const image = (id: string, extra: Record<string, unknown>) => ({
  id,
  wardrobeItemId: 'citem1',
  storageKey: `${KEY}.jpg`,
  thumbnailKey: `${KEY}_thumb.webp`,
  displayKey: `${KEY}_display.webp`,
  isPrimary: true,
  width: 1200,
  height: 1600,
  mimeType: 'image/jpeg',
  bytes: 123456,
  sha256: 'ab'.repeat(32),
  createdAt: created,
  ...extra,
})
const item = (extra: Record<string, unknown>) => ({
  id: 'citem1',
  userId: 'cgolden1',
  ...shirt,
  confidences: '{"category":0.95,"colors":0.9,"material":0.61}',
  wasCorrected: false,
  correctionLog: '[]',
  analysisProvider: 'mock',
  analysisModel: null,
  analysisVersion: null,
  analyzedAt: null,
  analysisRawConfidences: null,
  createdAt: created,
  updatedAt: updated,
  images: [image('cimg1', {})],
  ...extra,
})

const rows: Array<{ name: string; row: ReturnType<typeof item> }> = [
  { name: 'with variants', row: item({}) },
  { name: 'from before variants (master served)', row: item({ images: [image('cimg1', { displayKey: null, thumbnailKey: `${KEY}_thumb.jpg`, width: null, height: null, mimeType: null, bytes: null, sha256: null })] }) },
  { name: 'no thumbnail', row: item({ images: [image('cimg1', { thumbnailKey: null })] }) },
  { name: 'no images', row: item({ images: [] }) },
  { name: 'two images, the second primary', row: item({ images: [image('cimg1', { isPrimary: false }), image('cimg2', { storageKey: `${KEY}.png`, displayKey: null, thumbnailKey: null })] }) },
  { name: 'two images, both primary (the first counts)', row: item({ images: [image('cimg1', {}), image('cimg2', { storageKey: `${KEY}.png`, displayKey: null })] }) },
  { name: 'two images, none primary', row: item({ images: [image('cimg1', { isPrimary: false }), image('cimg2', { isPrimary: false, storageKey: `${KEY}.png` })] }) },
  { name: 'bare, corrected', row: item({ ...bare, confidences: '{}', wasCorrected: true, correctionLog: `[{"field":"pattern","from":"solid","to":"","at":"${AT}"}]` }) },
  { name: 'stored with spaces', row: item({ colors: '[ "white" , "navy" ]', season: '[]', confidences: '{ "category" : 1.0 }', correctionLog: '[ ]' }) },
]

const ttls = [undefined, '600']
const serialized: unknown[] = []
for (const baseUrl of [undefined, 'https://lookly.example.uz']) {
  for (const ttl of ttls) {
    if (baseUrl) process.env.PUBLIC_BASE_URL = baseUrl
    else delete process.env.PUBLIC_BASE_URL
    if (ttl) process.env.MEDIA_URL_TTL_SECONDS = ttl
    else delete process.env.MEDIA_URL_TTL_SECONDS
    for (const { name, row } of rows) {
      serialized.push({
        name,
        publicBaseUrl: baseUrl ?? null,
        ttlSeconds: ttl ? Number(ttl) : 3600,
        row: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), images: row.images.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })) },
        json: JSON.stringify(serializeWardrobeItem(row as never)),
      })
    }
  }
}

writeFileSync(
  out,
  JSON.stringify({ source: 'apps/web/src/lib/wardrobe (corrections.ts, serialize.ts)', now: NOW, signingSecret: process.env.MEDIA_SIGNING_SECRET, at: AT, existingLog: EXISTING_LOG, corrections, serialized }, null, 2) + '\n',
)
console.log(`${corrections.length} correction cases, ${serialized.length} serialized items → ${out}`)
