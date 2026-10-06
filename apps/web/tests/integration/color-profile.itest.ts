/**
 * COL: colour profile v2 end to end against real PostgreSQL: analysis and
 * storage, typed rejections that store nothing, one profile per user
 * (replacement), delete, authorization, privacy (no image data, no
 * provider/network call, no image in logs), and the migration + rollback.
 */
import { spawnSync } from 'child_process'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as analyze } from '@/app/api/v1/color-profile/analyze/route'
import { DELETE as remove, GET as current } from '@/app/api/v1/color-profile/route'
import { signAccessToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { setLLMProviderForTesting, setVisionProviderForTesting } from '@/lib/ai/providers'
import { selfie } from '../unit/ai/selfie-fixtures'
import { APP_DB, MIGRATION_NAMES, PG, createDb, dropDb, enabled, migrationsDir, prisma, rmDir, rows, sql } from './pg'

let seq = 0
async function newUser() {
  const id = `cu_${process.pid}_${++seq}`
  sql(APP_DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}

async function post(file: Buffer | null, headers: Record<string, string>, opts: { type?: string; name?: string } = {}) {
  const form = new FormData()
  if (file) form.append('file', new File([new Uint8Array(file)], opts.name ?? 'IMG_2026_secret-name.jpg', { type: opts.type ?? 'image/jpeg' }))
  else form.append('x', '1')
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  return analyze(
    new NextRequest('http://localhost/api/v1/color-profile/analyze', {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), ...headers },
      body,
    }),
    undefined,
  )
}
const get = (headers: Record<string, string>) => current(new NextRequest('http://localhost/api/v1/color-profile', { headers: { host: 'localhost', ...headers } }), undefined)
const del = (headers: Record<string, string>) => remove(new NextRequest('http://localhost/api/v1/color-profile', { method: 'DELETE', headers: { host: 'localhost', ...headers } }), undefined)

const WARM_LIGHT = { skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' }
const COOL_DEEP = { skin: '#7a5048', hair: '#0e0e10', eyes: '#1d1410' }

/** A selfie with EXIF and GPS metadata attached (must never be kept anywhere). */
const withGps = async (b: Buffer) =>
  sharp(b).withExif({ IFD0: { Make: 'SecretPhoneMaker', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 0/1' } }).jpeg().toBuffer()

describe.skipIf(!enabled)('COL: colour profile v2 (real PostgreSQL)', () => {
  let lines: string[] = []
  let fetchSpy: { mock: { calls: unknown[] } }
  beforeEach(() => {
    lines = []
    const push = (chunk: unknown) => {
      lines.push(String(chunk))
      return true
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    // Any AI provider call would throw: colour analysis must never use one.
    const forbidden = { name: 'gemini', model: 'forbidden' }
    setLLMProviderForTesting({ ...forbidden, generate: async () => { throw new Error('LLM provider called') } })
    setVisionProviderForTesting({ ...forbidden, analyzeImage: async () => { throw new Error('vision provider called') } })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setLLMProviderForTesting(null)
    setVisionProviderForTesting(null)
  })

  it('COL-01: a valid selfie → profile with season, confidences and version; GET returns the same', async () => {
    const u = await newUser()
    const res = await post(await selfie(WARM_LIGHT), u.auth)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.colorProfile).toMatchObject({ season: 'spring', undertone: 'warm', skinTone: 'light', hairColor: 'black', eyeColor: 'brown' })
    expect(body.colorProfile.confidence).toBeGreaterThan(0)
    expect(body.colorProfile.confidence).toBeLessThanOrEqual(0.8)
    expect(body.colorProfile.secondarySeason).not.toBe('spring')
    expect(body.disclaimer).toMatch(/tibbiy yoki ilmiy xulosa emas/)
    const g = await (await get(u.auth)).json()
    expect(g.status).toBe('analyzed')
    expect(g.colorProfile).toEqual(body.colorProfile)
    const row = await db.colorProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(row).toMatchObject({ analysisVersion: 'color-analysis-v2', season: 'spring', confidence: body.colorProfile.confidence })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await db.aiUsage.count({ where: { userId: u.id } })).toBe(0) // not a cloud AI call: no AI quota
  })

  it('COL-02: invalid file, bad dimensions, poor quality, no visible skin → typed 4xx; nothing stored', async () => {
    const u = await newUser()
    const cases: Array<[Buffer | null, string, number, { type?: string }?]> = [
      [null, 'BAD_REQUEST', 400],
      [Buffer.from('not an image at all'), 'INVALID_IMAGE', 422],
      [await selfie(WARM_LIGHT), 'INVALID_IMAGE', 422, { type: 'image/heic' }],
      [await sharp({ create: { width: 200, height: 200, channels: 3, background: '#d9a37f' } }).jpeg().toBuffer(), 'IMAGE_DIMENSIONS', 422],
      [await sharp(await selfie(WARM_LIGHT)).linear(0.15, 0).jpeg().toBuffer(), 'PHOTO_QUALITY_TOO_LOW', 422],
      [await sharp(await selfie(WARM_LIGHT)).blur(6).jpeg().toBuffer(), 'PHOTO_QUALITY_TOO_LOW', 422],
      [await selfie({ skin: '#3a6ea5', hair: null }), 'SKIN_NOT_VISIBLE', 422],
    ]
    for (const [file, code, status, opts] of cases) {
      const res = await post(file, u.auth, opts)
      expect(res.status, code).toBe(status)
      const body = await res.json()
      expect(body.code).toBe(code)
      expect(JSON.stringify(body)).not.toMatch(/sharp|laplacian|ycbcr|stack/i) // no internals
    }
    const blurred = await (await post(await sharp(await selfie(WARM_LIGHT)).blur(6).jpeg().toBuffer(), u.auth)).json()
    expect(blurred.details).toEqual([{ path: 'reason', message: 'blurry' }])
    expect(await db.colorProfile.count({ where: { userId: u.id } })).toBe(0)
    expect((await (await get(u.auth)).json()).status).toBe('not_analyzed')
  })

  it('COL-03: a rejected photo after a good one keeps the earlier profile unchanged', async () => {
    const u = await newUser()
    const first = await (await post(await selfie(WARM_LIGHT), u.auth)).json()
    expect((await post(await selfie({ skin: '#3a6ea5', hair: null }), u.auth)).status).toBe(422)
    expect((await (await get(u.auth)).json()).colorProfile).toEqual(first.colorProfile)
  })

  it('COL-04: a new analysis REPLACES the profile: one row per user, the user profile points at it', async () => {
    const u = await newUser()
    await post(await selfie(WARM_LIGHT), u.auth)
    const second = await (await post(await selfie(COOL_DEEP), u.auth)).json()
    expect(second.colorProfile.season).toBe('winter')
    expect(await db.colorProfile.count({ where: { userId: u.id } })).toBe(1)
    const up = await db.userProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(up).toMatchObject({ colorProfileId: second.colorProfile.id, skinTone: 'deep', skinUndertone: 'cool' })
    expect((await (await get(u.auth)).json()).colorProfile.season).toBe('winter')
  })

  it('COL-05: concurrent analyses still leave exactly one profile', async () => {
    const u = await newUser()
    const [a, b] = await Promise.all([selfie(WARM_LIGHT), selfie(COOL_DEEP)])
    const results = await Promise.all([post(a, u.auth), post(b, u.auth), post(a, u.auth)])
    expect(results.some((r) => r.status === 200)).toBe(true)
    expect(await db.colorProfile.count({ where: { userId: u.id } })).toBe(1)
  })

  it('COL-06: DELETE removes the profile and the selfie-derived fields; idempotent; other users untouched', async () => {
    const u = await newUser()
    const other = await newUser()
    await post(await selfie(WARM_LIGHT), u.auth)
    await post(await selfie(COOL_DEEP), other.auth)
    expect((await del(u.auth)).status).toBe(200)
    expect(await db.colorProfile.count({ where: { userId: u.id } })).toBe(0)
    expect(await db.userProfile.findUniqueOrThrow({ where: { userId: u.id } })).toMatchObject({
      colorProfileId: null, skinTone: null, skinUndertone: null, hairColor: null, eyeColor: null,
    })
    expect((await (await get(u.auth)).json()).status).toBe('not_analyzed')
    expect((await del(u.auth)).status).toBe(200) // again: nothing to delete
    expect(await db.colorProfile.count({ where: { userId: other.id } })).toBe(1)
  })

  it('COL-07: authorization: no token → 401 for analyse, get and delete', async () => {
    expect((await post(await selfie(WARM_LIGHT), {})).status).toBe(401)
    expect((await get({})).status).toBe(401)
    expect((await del({})).status).toBe(401)
  })

  it('COL-08: privacy: nothing of the image (bytes, name, EXIF/GPS) is stored or logged; no provider or network call', async () => {
    const u = await newUser()
    const res = await post(await withGps(await selfie(WARM_LIGHT)), u.auth, { name: 'IMG_2026_secret-name.jpg' })
    expect(res.status).toBe(200)
    const stored = rows(APP_DB, `SELECT row_to_json(cp)::text AS j FROM "ColorProfile" cp WHERE "userId" = '${u.id}'`)
    const profile = rows(APP_DB, `SELECT row_to_json(up)::text AS j FROM "UserProfile" up WHERE "userId" = '${u.id}'`)
    const all = JSON.stringify([stored, profile]) + lines.join('\n')
    for (const leak of ['secret-name', 'SecretPhoneMaker', 'GPS', 'Exif', '/9j/', 'base64', 'skinAvgRgb', 'hairAvgRgb']) expect(all).not.toContain(leak)
    const analysis = JSON.parse((await db.colorProfile.findUniqueOrThrow({ where: { userId: u.id } })).analysisJson)
    expect(Object.keys(analysis).sort()).toEqual(['agreement', 'eyesKnown', 'hairKnown', 'quality', 'skinPixels', 'skinRegions', 'version'])
    expect(fetchSpy).not.toHaveBeenCalled()
    // (Integration runs log at error level; the telemetry line itself is checked in tests/regression/ai-provider-layer.test.ts.)
  })

  it('COL-09: the migration keeps only each user’s current profile, labels it v1 and drops raw colour data; the rollback restores the old shape', async () => {
    const db_ = 'itest_color_migration'
    const V2 = MIGRATION_NAMES.indexOf('20261009000000_color_profile_v2')
    expect(V2).toBe(MIGRATION_NAMES.length - 1)
    createDb(db_)
    try {
      const before = migrationsDir(V2)
      expect((await prisma(db_, before)).code).toBe(0)
      rmDir(before)
      sql(db_, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u1','u1@test.local','x', now()), ('u2','u2@test.local','x', now());
        INSERT INTO "ColorProfile" ("id","userId","season","analysisJson","updatedAt","createdAt") VALUES
          ('old1','u1','summer','{"skinAvgRgb":{"r":1}}', now(), TIMESTAMP '2026-10-01'),
          ('cur1','u1','autumn','{"skinAvgRgb":{"r":2}}', now(), TIMESTAMP '2026-10-02'),
          ('cur2','u2','winter','{}', now(), TIMESTAMP '2026-10-03');
        INSERT INTO "UserProfile" ("id","userId","colorProfileId","updatedAt") VALUES ('p1','u1','cur1', now()), ('p2','u2','cur2', now());`)
      const all = migrationsDir()
      expect((await prisma(db_, all)).code).toBe(0)
      rmDir(all)
      expect(rows(db_, `SELECT "id", "season", "analysisVersion" AS v, "analysisJson" AS j, "confidence" AS c FROM "ColorProfile" ORDER BY "id"`)).toEqual([
        { id: 'cur1', season: 'autumn', v: 'color-heuristic-v1', j: '{}', c: null },
        { id: 'cur2', season: 'winter', v: 'color-heuristic-v1', j: '{}', c: null },
      ])
      const dup = spawnSync('psql', ['-X', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db_, '-c', `INSERT INTO "ColorProfile" ("id","userId","updatedAt") VALUES ('x','u1', now())`], { encoding: 'utf8' })
      expect(dup.stderr).toMatch(/unique/i)

      const downFile = path.resolve(__dirname, '../../../../docs/database/rollback/down-color-profile-v2.sql')
      const down = spawnSync('psql', ['--single-transaction', '-X', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db_, '-f', downFile], { encoding: 'utf8' })
      expect(down.status, `${down.stdout}${down.stderr}`).toBe(0)
      expect(sql(db_, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'ColorProfile' AND column_name IN ('analysisVersion','confidence','undertoneConfidence','secondarySeason','secondaryConfidence')`)).toBe('0')
      expect(sql(db_, `SELECT indexname FROM pg_indexes WHERE tablename = 'ColorProfile' AND indexname LIKE 'ColorProfile_userId%'`)).toBe('ColorProfile_userId_idx')
      expect(sql(db_, `SELECT count(*) FROM "ColorProfile"`)).toBe('2')
      const again = spawnSync('psql', ['--single-transaction', '-X', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db_, '-f', downFile], { encoding: 'utf8' })
      expect(again.status).not.toBe(0) // refuses a second run
    } finally {
      dropDb(db_)
    }
  })
})
