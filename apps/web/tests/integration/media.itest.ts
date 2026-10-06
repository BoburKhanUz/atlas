/**
 * MED / IDEM / SWEEP: wardrobe uploads end to end against real PostgreSQL and a
 * temporary storage directory — variants, validation, signed URLs,
 * PUBLIC_BASE_URL, Idempotency-Key, storage sweep and display backfill.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { POST as upload, GET as list } from '@/app/api/v1/wardrobe/items/route'
import { DELETE as deleteItem } from '@/app/api/v1/wardrobe/items/[id]/route'
import { GET as media } from '@/app/api/v1/media/[...key]/route'
import { signAccessToken } from '@/lib/auth'
import { assertServerConfig, ConfigError } from '@/lib/config'
import { db } from '@/lib/db'
import { getStorageProvider, setStorageProviderForTesting } from '@/lib/storage/provider'
import { backfillDisplayVariants, sweepStorage } from '@/server/media/maintenance'
import { claimIdempotencyKey } from '@/server/idempotency'
import { APP_DB, enabled, sql } from './pg'

const DB = APP_DB
let seq = 0

async function newUser() {
  const id = `mu_${process.pid}_${++seq}`
  sql(DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}

// Real multipart body: re-encode the FormData once so content-type and body share one boundary.
async function post(
  file: Buffer,
  opts: { type?: string; name?: string; headers?: Record<string, string>; fields?: Record<string, string> } = {},
) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(file)], opts.name ?? 'shirt.jpg', { type: opts.type ?? 'image/jpeg' }))
  for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v)
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  const req = new NextRequest('http://localhost/api/v1/wardrobe/items', {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), ...(opts.headers ?? {}) },
    body,
  })
  return upload(req, undefined)
}

const jpeg = (w: number, h: number, color = '#0F766E') =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .withMetadata({ exif: { IFD0: { Artist: 'gps-leak', Copyright: 'x' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 0/1' } } })
    .jpeg({ quality: 90 })
    .toBuffer()

async function fetchMedia(url: string, host = 'localhost') {
  const u = new URL(url, 'http://localhost')
  const key = decodeURIComponent(u.pathname.replace('/api/v1/media/', ''))
  return media(new NextRequest(u, { headers: { host } }), { params: Promise.resolve({ key: key.split('/') }) })
}

describe.skipIf(!enabled)('wardrobe uploads (real PostgreSQL + local storage)', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-media-itest-'))
    process.env.STORAGE_LOCAL_DIR = dir
    setStorageProviderForTesting(null)
  })
  afterAll(async () => {
    setStorageProviderForTesting(null)
    await fs.rm(dir, { recursive: true, force: true })
  })
  beforeEach(() => {
    delete process.env.PUBLIC_BASE_URL
  })

  describe('MED: variants and validation', () => {
    it('MED-01: master re-encoded without EXIF/GPS; 1600 px WebP display served as url; 400 px WebP thumb; master never handed out', async () => {
      const u = await newUser()
      const input = await jpeg(3000, 2000)
      expect((await sharp(input).metadata()).exif).toBeDefined()
      const res = await post(input, { headers: u.auth })
      expect(res.status).toBe(201)
      const { item } = await res.json()
      const row = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: item.id } }))!
      expect(row).toMatchObject({ width: 3000, height: 2000, mimeType: 'image/jpeg', bytes: input.length })
      expect(row.sha256).toBe(crypto.createHash('sha256').update(input).digest('hex'))
      expect(row.storageKey).toMatch(/^users\/mu_[\w]+\/[0-9a-f-]{36}\.jpg$/)
      expect(row.displayKey).toBe(row.storageKey.replace('.jpg', '_display.webp'))
      expect(row.thumbnailKey).toBe(row.storageKey.replace('.jpg', '_thumb.webp'))

      const storage = getStorageProvider()
      const master = await sharp((await storage.readObject(row.storageKey))!).metadata()
      expect(master).toMatchObject({ format: 'jpeg', width: 3000, height: 2000 })
      expect(master.exif).toBeUndefined()
      const display = await sharp((await storage.readObject(row.displayKey!))!).metadata()
      expect(display).toMatchObject({ format: 'webp', width: 1600, height: 1067 })
      expect(display.exif).toBeUndefined()
      const thumb = await sharp((await storage.readObject(row.thumbnailKey!))!).metadata()
      expect(thumb).toMatchObject({ format: 'webp', width: 400, height: 267 })

      const img = item.primaryImage
      expect(img.url).toContain(row.displayKey)
      expect(img.thumbnailUrl).toContain(row.thumbnailKey)
      expect(JSON.stringify(item)).not.toContain(row.storageKey)
      expect(Date.parse(img.urlExpiresAt)).toBeGreaterThan(Date.now())
      expect(img.url).toMatch(/^\/api\/v1\/media\//) // relative without PUBLIC_BASE_URL
      const served = await fetchMedia(img.url)
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('image/webp')
    })

    it('MED-01: PNG masters stay lossless (pixel-identical); WebP masters are re-encoded losslessly', async () => {
      const u = await newUser()
      const raw = crypto.randomBytes(300 * 260 * 3)
      const exif = { exif: { IFD0: { Artist: 'gps-leak' } } }
      const png = await sharp(raw, { raw: { width: 300, height: 260, channels: 3 } }).withMetadata(exif).png().toBuffer()
      expect((await sharp(png).metadata()).exif).toBeDefined()
      const r1 = await post(png, { headers: u.auth, type: 'image/png', name: 'a.png' })
      expect(r1.status).toBe(201)
      const pngRow = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: (await r1.json()).item.id } }))!
      expect(pngRow.storageKey).toMatch(/\.png$/)
      const pngMaster = (await getStorageProvider().readObject(pngRow.storageKey))!
      expect((await sharp(pngMaster).metadata()).exif).toBeUndefined()
      expect((await sharp(pngMaster).raw().toBuffer()).equals(raw)).toBe(true)

      const webp = await sharp(raw, { raw: { width: 300, height: 260, channels: 3 } }).withMetadata(exif).webp({ lossless: true }).toBuffer()
      expect((await sharp(webp).metadata()).exif).toBeDefined()
      const r2 = await post(webp, { headers: u.auth, type: 'image/webp', name: 'b.webp' })
      expect(r2.status).toBe(201)
      const webpRow = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: (await r2.json()).item.id } }))!
      expect(webpRow.storageKey).toMatch(/\.webp$/)
      const webpMaster = (await getStorageProvider().readObject(webpRow.storageKey))!
      expect((await sharp(webpMaster).metadata()).exif).toBeUndefined()
      expect((await sharp(webpMaster).removeAlpha().raw().toBuffer()).equals(raw)).toBe(true)
    })

    it('MED-02: wrong declared type 415, HEIF/AVIF 415, garbage 422, too small/too large 422 IMAGE_DIMENSIONS, > 8 MB 413; nothing stored', async () => {
      const u = await newUser()
      const before = await fs.readdir(path.join(dir, 'users')).catch(() => [])
      const count = () => db.wardrobeItem.count({ where: { userId: u.id } })
      const code = async (res: Response) => [res.status, (await res.json()).code]

      expect(await code(await post(await jpeg(400, 400), { headers: u.auth, type: 'text/plain' }))).toEqual([415, 'UNSUPPORTED_IMAGE_FORMAT'])
      expect(await code(await post(await jpeg(400, 400), { headers: u.auth, type: 'image/heic', name: 'IMG_0001.HEIC' }))).toEqual([415, 'UNSUPPORTED_IMAGE_FORMAT'])
      // real AVIF bytes (a HEIF container) declared as JPEG are still refused by content
      const avif = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#123456' } }).avif().toBuffer()
      expect(avif.toString('latin1', 4, 8)).toBe('ftyp')
      expect(await code(await post(avif, { headers: u.auth }))).toEqual([415, 'UNSUPPORTED_IMAGE_FORMAT'])
      // a fake HEIC header (undecodable here) is a format problem, not corruption
      const heicHeader = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1'), crypto.randomBytes(400)])
      expect(await code(await post(heicHeader, { headers: u.auth }))).toEqual([415, 'UNSUPPORTED_IMAGE_FORMAT'])
      // decodable but not accepted (GIF)
      const gif = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).gif().toBuffer()
      expect(await code(await post(gif, { headers: u.auth }))).toEqual([415, 'UNSUPPORTED_IMAGE_FORMAT'])
      expect(await code(await post(crypto.randomBytes(5000), { headers: u.auth }))).toEqual([422, 'INVALID_IMAGE'])
      expect(await code(await post(await jpeg(255, 600), { headers: u.auth }))).toEqual([422, 'IMAGE_DIMENSIONS'])
      expect(await code(await post(await jpeg(8001, 300), { headers: u.auth }))).toEqual([422, 'IMAGE_DIMENSIONS'])
      const big = Buffer.concat([await jpeg(400, 400), crypto.randomBytes(8 * 1024 * 1024)])
      expect(await code(await post(big, { headers: u.auth }))).toEqual([413, 'PAYLOAD_TOO_LARGE'])
      // boundaries that pass: exactly 256 and exactly 8000
      expect((await post(await jpeg(256, 8000), { headers: u.auth })).status).toBe(201)

      expect(await count()).toBe(1)
      const userDir = path.join(dir, 'users', u.id)
      expect((await fs.readdir(userDir)).length).toBe(3) // only the accepted upload's three variants
      expect(before).not.toContain(u.id)
    })

    it('MED-02: EXIF orientation is applied before the dimension check and stored dimensions', async () => {
      const u = await newUser()
      const rotated = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#333' } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer()
      const res = await post(rotated, { headers: u.auth })
      expect(res.status).toBe(201)
      const img = (await res.json()).item.primaryImage
      expect([img.width, img.height]).toEqual([300, 600])
    })

    it('MED-03: images uploaded before variants fall back to the master; backfill creates the display variant (dry run first, re-runnable)', async () => {
      const u = await newUser()
      const res = await post(await jpeg(2000, 1000), { headers: u.auth })
      const itemId = (await res.json()).item.id
      const row = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: itemId } }))!
      // simulate a Phase 2 row: no display variant
      await getStorageProvider().deleteObjects([row.displayKey])
      await db.wardrobeImage.update({ where: { id: row.id }, data: { displayKey: null } })
      const listed = await (await list(new NextRequest('http://localhost/api/v1/wardrobe/items', { headers: u.auth }), undefined)).json()
      expect(listed.items[0].primaryImage.url).toContain(row.storageKey)

      const dry = await backfillDisplayVariants(db, getStorageProvider(), { apply: false })
      expect(dry.missingDisplay).toBeGreaterThanOrEqual(1)
      expect((await db.wardrobeImage.findUnique({ where: { id: row.id } }))!.displayKey).toBeNull()
      const applied = await backfillDisplayVariants(db, getStorageProvider(), { apply: true })
      expect(applied.failed).toEqual([])
      const fixed = (await db.wardrobeImage.findUnique({ where: { id: row.id } }))!
      expect(fixed.displayKey).toBe(row.displayKey)
      expect((await sharp((await getStorageProvider().readObject(fixed.displayKey!))!).metadata()).width).toBe(1600)
      expect((await backfillDisplayVariants(db, getStorageProvider(), { apply: true })).missingDisplay).toBe(0)
    })

    it('MED-04: deleting an item removes master, display and thumbnail', async () => {
      const u = await newUser()
      const res = await post(await jpeg(500, 500), { headers: u.auth })
      const itemId = (await res.json()).item.id
      const row = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: itemId } }))!
      const del = await deleteItem(new NextRequest(`http://localhost/api/v1/wardrobe/items/${itemId}`, { method: 'DELETE', headers: u.auth }), {
        params: Promise.resolve({ id: itemId }),
      })
      expect(del.status).toBe(200)
      for (const k of [row.storageKey, row.displayKey, row.thumbnailKey]) expect(await getStorageProvider().readObject(k!)).toBeNull()
    })

    it('MED-05: PUBLIC_BASE_URL makes links absolute (a spoofed Host has no effect); invalid values stop startup', async () => {
      const u = await newUser()
      process.env.PUBLIC_BASE_URL = 'https://api.atlas.example'
      const res = await post(await jpeg(400, 400), { headers: { ...u.auth, host: 'evil.example', 'x-forwarded-host': 'evil.example' } })
      const img = (await res.json()).item.primaryImage
      expect(img.url).toMatch(/^https:\/\/api\.atlas\.example\/api\/v1\/media\/users\//)
      expect(img.thumbnailUrl).toMatch(/^https:\/\/api\.atlas\.example\//)
      expect(JSON.stringify(img)).not.toContain('evil.example')
      expect((await fetchMedia(img.url, 'evil.example')).status).toBe(200)

      for (const bad of ['not a url', 'ftp://x.example', 'https://x.example/path', 'https://x.example?q=1', 'https://u:p@x.example', 'https://x.example#f']) {
        process.env.PUBLIC_BASE_URL = bad
        expect(() => assertServerConfig(), bad).toThrow(ConfigError)
      }
      const env = process.env as Record<string, string | undefined>
      const nodeEnv = env.NODE_ENV
      const ai = { AI_LLM_PROVIDER: env.AI_LLM_PROVIDER, AI_ALLOW_MOCK_IN_PRODUCTION: env.AI_ALLOW_MOCK_IN_PRODUCTION }
      try {
        env.NODE_ENV = 'production'
        // production also validates the AI configuration (Phase 4.0); acknowledge the mock
        env.AI_LLM_PROVIDER = 'mock'
        env.AI_ALLOW_MOCK_IN_PRODUCTION = '1'
        process.env.PUBLIC_BASE_URL = 'http://api.atlas.example'
        expect(() => assertServerConfig()).toThrow(/https/)
        process.env.PUBLIC_BASE_URL = 'http://localhost:3000'
        expect(() => assertServerConfig()).not.toThrow()
        process.env.PUBLIC_BASE_URL = 'https://API.atlas.example/'
        expect(() => assertServerConfig()).not.toThrow()
      } finally {
        env.NODE_ENV = nodeEnv
        for (const [k, v] of Object.entries(ai)) {
          if (v === undefined) delete env[k]
          else env[k] = v
        }
      }
    })
  })

  describe('IDEM: Idempotency-Key on uploads', () => {
    const key = () => `k_${crypto.randomBytes(8).toString('hex')}`

    it('IDEM-01: same key + same payload → the original item (201, Idempotent-Replayed), no duplicate row or file', async () => {
      const u = await newUser()
      const file = await jpeg(500, 400)
      const k = key()
      const first = await post(file, { headers: { ...u.auth, 'idempotency-key': k } })
      expect(first.status).toBe(201)
      expect(first.headers.get('idempotent-replayed')).toBeNull()
      const a = await first.json()
      const again = await post(file, { headers: { ...u.auth, 'idempotency-key': k } })
      expect(again.status).toBe(201)
      expect(again.headers.get('idempotent-replayed')).toBe('true')
      const b = await again.json()
      expect(b.item.id).toBe(a.item.id)
      expect(b.detection).toEqual(a.detection)
      expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(1)
      expect((await fs.readdir(path.join(dir, 'users', u.id))).length).toBe(3)
      // without the header: a normal second upload
      expect((await post(file, { headers: u.auth })).status).toBe(201)
      expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(2)
    })

    it('IDEM-02: same key, different payload (bytes or filename) → 409 IDEMPOTENCY_KEY_MISMATCH; malformed key → 400', async () => {
      const u = await newUser()
      const k = key()
      expect((await post(await jpeg(500, 400), { headers: { ...u.auth, 'idempotency-key': k } })).status).toBe(201)
      for (const res of [
        await post(await jpeg(500, 400, '#ff0000'), { headers: { ...u.auth, 'idempotency-key': k } }),
        await post(await jpeg(500, 400), { headers: { ...u.auth, 'idempotency-key': k }, name: 'other.jpg' }),
        await post(await jpeg(500, 400), { headers: { ...u.auth, 'idempotency-key': k }, fields: { filename: 'pants.jpg' } }),
      ]) {
        expect(res.status).toBe(409)
        expect((await res.json()).code).toBe('IDEMPOTENCY_KEY_MISMATCH')
      }
      for (const bad of ['short', 'x'.repeat(129), 'has space', 'ünicode-key-123']) {
        const res = await post(await jpeg(500, 400), { headers: { ...u.auth, 'idempotency-key': bad } })
        expect(res.status, bad).toBe(400)
      }
      expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(1)
    })

    it('IDEM-03: in progress → 409 + Retry-After; failed attempts can be retried; stale (≥ 5 min) claims are taken over; keys expire after 24 h', async () => {
      const u = await newUser()
      const file = await jpeg(500, 400)
      const k = key()
      // a concurrent duplicate: the first request has claimed the key and is still processing
      const hash = (await import('@/server/idempotency')).multipartRequestHash({ fileBytes: file, filename: 'shirt.jpg', fields: {} })
      const claim = await claimIdempotencyKey(db, { userId: u.id, route: 'POST /api/v1/wardrobe/items', key: k, requestHash: hash })
      expect(claim.kind).toBe('claimed')
      const busy = await post(file, { headers: { ...u.auth, 'idempotency-key': k } })
      expect(busy.status).toBe(409)
      expect((await busy.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS')
      expect(busy.headers.get('retry-after')).toBe('5')
      // the claim goes stale (crashed request) → taken over and processed
      sql(DB, `UPDATE "IdempotencyKey" SET "createdAt" = "createdAt" - interval '5 minutes' WHERE "key" = '${k}'`)
      const takeover = await post(file, { headers: { ...u.auth, 'idempotency-key': k } })
      expect(takeover.status).toBe(201)
      expect(takeover.headers.get('idempotent-replayed')).toBeNull()

      // a failed attempt releases the key: the retry runs normally
      const k2 = key()
      const failed = await post(await jpeg(100, 100), { headers: { ...u.auth, 'idempotency-key': k2 } })
      expect(failed.status).toBe(422)
      expect(sql(DB, `SELECT count(*) FROM "IdempotencyKey" WHERE "key" = '${k2}'`)).toBe('0')
      const fixed = await post(await jpeg(100, 100), { headers: { ...u.auth, 'idempotency-key': k2 } })
      expect(fixed.status).toBe(422) // same payload, same outcome — and still no key left behind
      expect(sql(DB, `SELECT count(*) FROM "IdempotencyKey" WHERE "key" = '${k2}'`)).toBe('0')

      // expiry: a 24 h old completed key no longer replays
      const k3 = key()
      const orig = await (await post(file, { headers: { ...u.auth, 'idempotency-key': k3 } })).json()
      expect(sql(DB, `SELECT "expiresAt" - "createdAt" FROM "IdempotencyKey" WHERE "key" = '${k3}'`)).toBe('1 day')
      sql(DB, `UPDATE "IdempotencyKey" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "key" = '${k3}'`)
      const after = await post(file, { headers: { ...u.auth, 'idempotency-key': k3 } })
      expect(after.status).toBe(201)
      expect((await after.json()).item.id).not.toBe(orig.item.id)
    })

    it('IDEM-03: a slow request whose claim was taken over cannot complete — its item rolls back (no duplicate)', async () => {
      const u = await newUser()
      const { completeIdempotencyKey } = await import('@/server/idempotency')
      const k = key()
      const claimA = await claimIdempotencyKey(db, { userId: u.id, route: 'r', key: k, requestHash: 'h' })
      if (claimA.kind !== 'claimed') throw new Error('expected claim')
      sql(DB, `UPDATE "IdempotencyKey" SET "createdAt" = "createdAt" - interval '6 minutes' WHERE "key" = '${k}'`)
      const claimB = await claimIdempotencyKey(db, { userId: u.id, route: 'r', key: k, requestHash: 'h' })
      expect(claimB.kind).toBe('claimed')
      const before = await db.wardrobeItem.count({ where: { userId: u.id } })
      await expect(
        db.$transaction(async (tx) => {
          const item = await tx.wardrobeItem.create({ data: { userId: u.id, category: 'shirt', updatedAt: new Date() } })
          await completeIdempotencyKey(tx, claimA, item.id, 201)
        }),
      ).rejects.toThrow(/taken over/)
      expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(before)
    })

    it('IDEM-03: 5 concurrent identical uploads with one key → exactly one item; the others get 409 in progress or the replay', async () => {
      const u = await newUser()
      const file = await jpeg(1200, 900)
      const k = key()
      const results = await Promise.all(Array.from({ length: 5 }, () => post(file, { headers: { ...u.auth, 'idempotency-key': k } })))
      const created = results.filter((r) => r.status === 201 && !r.headers.get('idempotent-replayed'))
      expect(created).toHaveLength(1)
      for (const r of results.filter((x) => !created.includes(x))) {
        if (r.status === 409) expect((await r.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS')
        else expect([r.status, r.headers.get('idempotent-replayed')]).toEqual([201, 'true'])
      }
      expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(1)
      expect((await fs.readdir(path.join(dir, 'users', u.id))).length).toBe(3)
    })

    it('IDEM-04: keys are per user — two users can use the same key', async () => {
      const [a, b] = [await newUser(), await newUser()]
      const k = key()
      const file = await jpeg(500, 400)
      const ra = await post(file, { headers: { ...a.auth, 'idempotency-key': k } })
      const rb = await post(file, { headers: { ...b.auth, 'idempotency-key': k } })
      expect([ra.status, rb.status]).toEqual([201, 201])
      expect(rb.headers.get('idempotent-replayed')).toBeNull()
      expect((await ra.json()).item.id).not.toBe((await rb.json()).item.id)
    })
  })

  describe('SWEEP: storage sweep', () => {
    it('reports orphans (dry run changes nothing), keeps recent and referenced files, deletes with --apply', async () => {
      const u = await newUser()
      const res = await post(await jpeg(500, 500), { headers: u.auth })
      const row = (await db.wardrobeImage.findFirst({ where: { wardrobeItemId: (await res.json()).item.id } }))!
      const storage = getStorageProvider()
      // a display file left behind (e.g. Phase 2 deleted the item during a rollback)
      const orphanKey = `users/${u.id}/${crypto.randomUUID()}_display.webp`
      await storage.writeObject(orphanKey, await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } }).webp().toBuffer())
      await fs.writeFile(path.join(dir, 'users', u.id, 'notes.txt'), 'x')
      const later = new Date(Date.now() + 2 * 3600_000)

      const recent = await sweepStorage(db, storage, { apply: false, minAgeMs: 3600_000 })
      expect(recent.orphans).not.toContain(orphanKey)
      const dry = await sweepStorage(db, storage, { apply: false, minAgeMs: 3600_000, now: later })
      expect(dry.orphans).toContain(orphanKey)
      expect(dry.unknown).toContain(`users/${u.id}/notes.txt`)
      expect(await storage.readObject(orphanKey)).not.toBeNull()
      const applied = await sweepStorage(db, storage, { apply: true, minAgeMs: 3600_000, now: later })
      expect(applied.orphans).toContain(orphanKey)
      expect(await storage.readObject(orphanKey)).toBeNull()
      for (const k of [row.storageKey, row.displayKey, row.thumbnailKey]) expect(await storage.readObject(k!)).not.toBeNull()
      expect(await fs.readFile(path.join(dir, 'users', u.id, 'notes.txt'), 'utf8')).toBe('x')
    })
  })
})
