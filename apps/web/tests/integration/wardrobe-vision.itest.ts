/**
 * VIS: real-provider clothing analysis end to end against real PostgreSQL,
 * local storage and the AiUsage quota — with a scripted provider (no network,
 * no paid API). Replay, refund/charge, quota limit under concurrency, cleanup
 * and the stored analysis metadata.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { POST as upload } from '@/app/api/v1/wardrobe/items/route'
import { signAccessToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import { setVisionProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import type { VisionProvider, VisionRequest } from '@/lib/ai/providers/types'
import { getAiUsage } from '@/lib/ai/quota'
import { setStorageProviderForTesting } from '@/lib/storage/provider'
import { spawnSync } from 'child_process'
import { APP_DB, MIGRATION_NAMES, PG, createDb, dropDb, enabled, migrationsDir, prisma, rmDir, rows, sql } from './pg'

let seq = 0
async function newUser() {
  const id = `vu_${process.pid}_${++seq}`
  sql(APP_DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}

async function post(file: Buffer, headers: Record<string, string>) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(file)], 'photo.jpg', { type: 'image/jpeg' }))
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  return upload(
    new NextRequest('http://localhost/api/v1/wardrobe/items', {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), ...headers },
      body,
    }),
    undefined,
  )
}

const jpeg = (color = '#2F5DA8') => sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).jpeg().toBuffer()
const conf = (v: number) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v]))
const jeans = () => ({
  subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'denim', material: 'denim',
  sleeveLength: null, fit: 'slim', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: conf(0.91),
})
const none = (subject: string) => ({
  subject, category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null,
  style: null, season: [], gender: null, formality: null, confidence: conf(0),
})

class Scripted implements VisionProvider {
  readonly name = 'openai'
  readonly model = 'openai-test-vision'
  calls = 0
  constructor(private readonly step: (req: VisionRequest) => unknown | Promise<unknown>) {}
  async analyzeImage(req: VisionRequest) {
    this.calls++
    return { output: await this.step(req), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}

describe.skipIf(!enabled)('VIS: real-provider clothing analysis (real PostgreSQL + storage + quota)', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-vision-itest-'))
    process.env.STORAGE_LOCAL_DIR = dir
    setStorageProviderForTesting(null)
  })
  afterAll(async () => {
    setStorageProviderForTesting(null)
    setVisionProviderForTesting(null)
    await fs.rm(dir, { recursive: true, force: true })
  })
  afterEach(() => setVisionProviderForTesting(null))

  const files = async (userId: string) => fs.readdir(path.join(dir, 'users', userId)).catch(() => [] as string[])
  const usage = (userId: string) => getAiUsage(userId, 'clothing_analysis')

  it('VIS-01: success stores attributes + metadata (mock=false); a replay returns it without re-analysis or charge', async () => {
    const u = await newUser()
    const p = new Scripted(() => jeans())
    setVisionProviderForTesting(p)
    const key = { ...u.auth, 'idempotency-key': `vis-${crypto.randomUUID()}` }
    const first = await post(await jpeg(), key)
    expect(first.status).toBe(201)
    const a = await first.json()
    expect(a.detection).toMatchObject({ category: 'pants', subcategory: 'jeans', mock: false })
    const row = await db.wardrobeItem.findUniqueOrThrow({ where: { id: a.item.id } })
    expect(row).toMatchObject({ analysisProvider: 'openai', analysisModel: 'openai-test-vision', analysisVersion: 'v1' })
    expect(row.analyzedAt).toBeInstanceOf(Date)
    expect(JSON.parse(row.analysisRawConfidences!)).toEqual(conf(0.91))
    expect(JSON.parse(row.confidences).category).toBeLessThan(0.7) // presented: uncalibrated cap
    expect(await usage(u.id)).toBe(1)

    const replay = await post(await jpeg(), key)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect((await replay.json()).detection).toEqual(a.detection) // mock=false from the stored provider
    expect(p.calls).toBe(1)
    expect(await usage(u.id)).toBe(1)
  })

  it('VIS-02: AI_UNAVAILABLE → 503, quota refunded, files removed, key released (the same key works later)', async () => {
    const u = await newUser()
    setVisionProviderForTesting(new Scripted(() => {
      throw new AiProviderError('unavailable', 'openai', { status: 503 })
    }))
    const key = { ...u.auth, 'idempotency-key': `vis-${crypto.randomUUID()}` }
    const res = await post(await jpeg(), key)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('AI_UNAVAILABLE')
    expect(res.headers.get('retry-after')).toBe('15')
    expect(await usage(u.id)).toBe(0)
    expect(await files(u.id)).toEqual([])
    expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(0)
    setVisionProviderForTesting(new Scripted(() => jeans()))
    expect((await post(await jpeg(), key)).status).toBe(201)
    expect(await usage(u.id)).toBe(1)
  })

  it('VIS-03: NOT_A_GARMENT → 422, charged, nothing stored', async () => {
    const u = await newUser()
    setVisionProviderForTesting(new Scripted(() => none('no_garment')))
    const res = await post(await jpeg('#D9A066'), u.auth)
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('NOT_A_GARMENT')
    expect(await usage(u.id)).toBe(1)
    expect(await files(u.id)).toEqual([])
    expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(0)
  })

  it('VIS-04: invalid images never reach the provider or the quota', async () => {
    const u = await newUser()
    const p = new Scripted(() => jeans())
    setVisionProviderForTesting(p)
    expect((await post(Buffer.from('<html>not an image</html>'), u.auth)).status).toBe(422)
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).jpeg().toBuffer()
    expect((await post(tiny, u.auth)).status).toBe(422)
    expect(p.calls).toBe(0)
    expect(await usage(u.id)).toBe(0)
  })

  it('VIS-05: at the daily limit → 429 AI_QUOTA_EXCEEDED with Retry-After; concurrent uploads never exceed 50', async () => {
    const u = await newUser()
    const p = new Scripted(async () => {
      await new Promise((r) => setTimeout(r, 30)) // overlap the requests
      return jeans()
    })
    setVisionProviderForTesting(p)
    sql(APP_DB, `INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('${crypto.randomUUID()}','${u.id}','clothing_analysis', (now() AT TIME ZONE 'Asia/Tashkent')::date, 48, now())`)
    const results = await Promise.all(Array.from({ length: 5 }, async () => post(await jpeg(), u.auth)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 201, 429, 429, 429])
    expect(p.calls).toBe(2)
    expect(await usage(u.id)).toBe(50)
    const limited = results.find((r) => r.status === 429)!
    expect((await limited.json()).code).toBe('AI_QUOTA_EXCEEDED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await db.wardrobeItem.count({ where: { userId: u.id } })).toBe(2)
    expect((await files(u.id)).length).toBe(2 * 3) // master + display + thumb per stored item only
  })

  it('VIS-07: the metadata migration labels existing items as the mock explicitly; the rollback drops only the metadata', async () => {
    const db_ = 'itest_vis_migration'
    const META = MIGRATION_NAMES.indexOf('20261008000000_wardrobe_analysis_metadata')
    expect(META).toBe(MIGRATION_NAMES.length - 1)
    createDb(db_)
    try {
      const before = migrationsDir(META)
      expect((await prisma(db_, before)).code).toBe(0)
      rmDir(before)
      sql(db_, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u1','u1@test.local','x', now());
               INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt","createdAt") VALUES ('w1','u1','shirt', now(), TIMESTAMP '2026-10-01 10:00:00')`)
      const all = migrationsDir()
      expect((await prisma(db_, all)).code).toBe(0)
      rmDir(all)
      expect(rows(db_, `SELECT "analysisProvider" AS p, "analysisModel" AS m, "analysisVersion" AS v, "analyzedAt" = "createdAt" AS same, "analysisRawConfidences" AS raw FROM "WardrobeItem"`)).toEqual([
        { p: 'mock', m: 'mock-vision', v: 'pre-4.1', same: true, raw: null },
      ])
      const downFile = path.resolve(__dirname, '../../../../docs/database/rollback/down-wardrobe-analysis-metadata.sql')
      const down = spawnSync('psql', ['--single-transaction', '-X', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db_, '-f', downFile], { encoding: 'utf8' })
      expect(down.status, `${down.stdout}${down.stderr}`).toBe(0)
      expect(sql(db_, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'WardrobeItem' AND column_name LIKE 'analy%'`)).toBe('0')
      expect(sql(db_, `SELECT "category" FROM "WardrobeItem" WHERE "id" = 'w1'`)).toBe('shirt')
    } finally {
      dropDb(db_)
    }
  })

  it('VIS-06: the mock provider stores mock metadata and never uses quota', async () => {
    const u = await newUser()
    const res = await post(await jpeg(), u.auth) // default provider: the mock
    expect(res.status).toBe(201)
    const a = await res.json()
    expect(a.detection.mock).toBe(true)
    const row = await db.wardrobeItem.findUniqueOrThrow({ where: { id: a.item.id } })
    expect(row).toMatchObject({ analysisProvider: 'mock', analysisModel: 'mock-vision', analysisVersion: 'mock', analysisRawConfidences: null })
    expect(await db.aiUsage.count({ where: { userId: u.id } })).toBe(0)
  })
})
