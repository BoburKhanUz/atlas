/**
 * LT: legacy session lifetime across the cutover. Phase 2 chains of different
 * ages are migrated by the real migration on PostgreSQL and then refreshed
 * through the real protocol under the database test clock.
 *
 * Expected (docs/database/cutover.md, "Legacy session lifetime"):
 *   absoluteExpiresAt = LEAST(C + 90 d, GREATEST(chain start + 90 d, C + 30 d)),
 *   C = legacyCutoverAt. Families created by a login after the cutover keep
 *   createdAt + 90 d (web and mobile).
 */
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashToken } from '@/lib/auth'
import { legacyAbsoluteExpiresAt, preflightFamilies } from '@/server/session/maintenance'
import { endSession, refreshSession, startSession, type RefreshResult } from '@/server/session/protocol'
import {
  PG, createDb, dbUrl, dropDb, enabled, installTestClock, migrationsDir, MIGRATION_NAMES, prisma, rmDir, rows, setClock, sql, sqlTimestamp,
} from './pg'

const M4 = MIGRATION_NAMES.indexOf('20261006000300_session_families')
const DB = 'itest_lt'
const DAY = 24 * 3600 * 1000
const MIN = 60_000
const DOWN_SQL = path.resolve(__dirname, '../../../../docs/database/rollback/down-session-families.sql')

const token = () => crypto.randomBytes(32).toString('base64url')
const ms = (q: string) => Number(sql(DB, `SELECT (extract(epoch FROM (${q})) * 1000)::bigint`))
const ts = (d: Date) => `TIMESTAMP '${sqlTimestamp(d)}'`

interface Chain {
  name: string
  user: string
  start: Date
  rootTok: string // rotated (legacy) token
  tailTok: string // live token
}

describe.skipIf(!enabled)('legacy session lifetime across the cutover (real PostgreSQL)', () => {
  const dirs: string[] = []
  let client: PrismaClient
  let now0: number // database time when the Phase 2 rows were written
  let C: Date // legacyCutoverAt
  const chains = new Map<string, Chain>()

  /** A Phase 2 chain: root (rotated at start + 1 min) → live tail created 1 day before the migration. */
  function phase2Chain(name: string, startOffset: number, live = true) {
    const user = `lt_${name}`
    const start = new Date(now0 + startOffset)
    const tailCreated = new Date(Math.max(start.getTime() + MIN, now0 - DAY))
    const c: Chain = { name, user, start, rootTok: token(), tailTok: token() }
    sql(
      DB,
      `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${user}','${user}@test.local','x', now());
       INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById") VALUES
         ('${user}_tail','${user}','${hashToken(c.tailTok)}', ${ts(new Date(tailCreated.getTime() + 30 * DAY))}, ${ts(tailCreated)},
          ${live ? 'NULL' : ts(new Date(now0 - MIN))}, NULL),
         ('${user}_root','${user}','${hashToken(c.rootTok)}', ${ts(new Date(start.getTime() + 30 * DAY))}, ${ts(start)},
          ${ts(new Date(start.getTime() + MIN))}, '${user}_tail');`,
    )
    chains.set(name, c)
    return c
  }

  const family = (c: Chain) =>
    rows<{ id: string; abs: string; revokedAt: string | null; revokeReason: string | null; clientType: string }>(
      DB,
      `SELECT f."id", (extract(epoch FROM f."absoluteExpiresAt") * 1000)::bigint::text AS abs, f."revokedAt"::text, f."revokeReason", f."clientType"
         FROM "SessionFamily" f WHERE f."userId" = '${c.user}'`,
    )
  const absOf = (c: Chain) => Number(family(c)[0].abs)
  const refresh = (t: string, clientType: 'web' | 'mobile' = 'web') => refreshSession(client, t, { clientType })
  const at = (d: Date | number) => setClock(DB, new Date(typeof d === 'number' ? d : d.getTime()))
  function ok(r: RefreshResult) {
    if (!r.ok) throw new Error(`expected success, got ${r.code}`)
    return r
  }

  beforeAll(async () => {
    createDb(DB)
    const before = migrationsDir(M4)
    dirs.push(before)
    const r = await prisma(DB, before)
    expect(r.code, r.output).toBe(0)
    now0 = ms(`date_trunc('milliseconds', now() AT TIME ZONE 'UTC')`)
    phase2Chain('recent', -10 * DAY)
    phase2Chain('d59', -59 * DAY)
    phase2Chain('d61', -61 * DAY)
    phase2Chain('old', -200 * DAY)
    phase2Chain('old2', -200 * DAY)
    phase2Chain('oldreplay', -365 * DAY)
    phase2Chain('future', 5 * DAY) // clock skew: chain start after the cutover
    phase2Chain('oldout', -200 * DAY, false) // logged out under Phase 2
    client = new PrismaClient({ datasourceUrl: dbUrl(DB) })
  })

  afterAll(async () => {
    await client?.$disconnect()
    dirs.forEach(rmDir)
    if (!process.env.ATLAS_ITEST_KEEP) dropDb(DB)
  })

  it('LT-01: the read-only preflight predicts which live chains get the transition limit', async () => {
    const report = await preflightFamilies(client)
    expect(report.anomalies).toEqual([])
    expect(report.planned).toEqual({ healthyLive: 7, migratedRevoked: 1, anomaly: 0 })
    // d61, old, old2, oldreplay → transition; recent, d59, future → chain start
    expect(report.legacyLifetime).toMatchObject({ transition: 4, fromChainStart: 3 })
    expect(Math.abs(Date.parse(report.legacyLifetime.transitionEndsAt) - (now0 + 30 * DAY))).toBeLessThan(5 * MIN)
  })

  it('LT-02: the migration sets LEAST(C + 90 d, GREATEST(start + 90 d, C + 30 d)) for every legacy family', async () => {
    const full = migrationsDir()
    dirs.push(full)
    const r = await prisma(DB, full)
    expect(r.code, r.output).toBe(0)
    C = new Date(ms(`SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`))
    installTestClock(DB)
    const expected: Record<string, number> = {
      recent: chains.get('recent')!.start.getTime() + 90 * DAY, // start + 90 d
      d59: chains.get('d59')!.start.getTime() + 90 * DAY, // start + 90 d (> C + 30 d)
      d61: C.getTime() + 30 * DAY, // transition
      old: C.getTime() + 30 * DAY,
      old2: C.getTime() + 30 * DAY,
      oldreplay: C.getTime() + 30 * DAY,
      future: C.getTime() + 90 * DAY, // capped at C + 90 d
      oldout: C.getTime() + 30 * DAY,
    }
    for (const [name, c] of chains) {
      const f = family(c)
      expect(f, name).toHaveLength(1)
      expect(Number(f[0].abs), name).toBe(expected[name])
      expect(Number(f[0].abs), name).toBe(legacyAbsoluteExpiresAt(c.start, C).getTime())
      expect(Number(f[0].abs), name).toBeLessThanOrEqual(C.getTime() + 90 * DAY)
      expect(f[0].clientType).toBe('web')
    }
    expect(family(chains.get('oldout')!)[0].revokeReason).toBe('migrated')
    // exact boundary of the formula: GREATEST picks start + 90 d iff start > C − 60 d
    expect(chains.get('d59')!.start.getTime()).toBeGreaterThan(C.getTime() - 60 * DAY)
    expect(chains.get('d61')!.start.getTime()).toBeLessThan(C.getTime() - 60 * DAY)
  })

  it('LT-03: an old chain keeps working through the transition and expires exactly at C + 30 d', async () => {
    const c = chains.get('old')!
    const limit = C.getTime() + 30 * DAY
    at(C.getTime() + MIN)
    const r1 = ok(await refresh(c.tailTok))
    expect(r1.issued.sessionExpiresAt.getTime()).toBe(limit)
    expect(r1.issued.refreshTokenExpiresAt.getTime()).toBe(limit) // min(t + 30 d, limit)
    at(limit - 15 * MIN)
    const r2 = ok(await refresh(r1.issued.refreshToken))
    expect(r2.issued.accessTokenExpiresAt.getTime()).toBe(Math.floor(limit / 1000) * 1000) // min(t + 15 min, limit), JWT whole seconds
    at(limit - 1)
    const r3 = ok(await refresh(r2.issued.refreshToken))
    expect(r3.issued.accessTokenExpiresAt.getTime()).toBe(Math.floor(limit / 1000) * 1000)
    at(limit)
    expect(await refresh(r3.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
    const f = family(c)[0]
    expect(f.revokeReason).toBe('expired')
    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "familyId" = '${f.id}' AND "revokedAt" IS NULL`)).toBe('0')
    // the user signs in again: a normal family with createdAt + 90 d
    at(limit + MIN)
    const fresh = await startSession(client, { id: c.user, email: `${c.user}@test.local`, name: null }, { clientType: 'web' })
    expect(fresh.sessionExpiresAt.getTime()).toBe(limit + MIN + 90 * DAY)
  })

  it('LT-04: an old chain not used during the transition is rejected after C + 30 d (no extension by waiting)', async () => {
    const c = chains.get('old2')!
    at(C.getTime() + 30 * DAY)
    expect(await refresh(c.tailTok)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
    expect(family(c)[0].revokeReason).toBe('expired')
  })

  it('LT-05: a recent chain keeps its original start + 90 d and is not cut at C + 30 d', async () => {
    const c = chains.get('recent')!
    const limit = c.start.getTime() + 90 * DAY
    at(C.getTime() + MIN)
    const r1 = ok(await refresh(c.tailTok))
    expect(r1.issued.sessionExpiresAt.getTime()).toBe(limit)
    at(C.getTime() + 30 * DAY) // past the transition end
    const r2 = ok(await refresh(r1.issued.refreshToken))
    at(C.getTime() + 59 * DAY)
    const r3 = ok(await refresh(r2.issued.refreshToken))
    at(limit - 1)
    const r4 = ok(await refresh(r3.issued.refreshToken))
    expect(r4.issued.refreshTokenExpiresAt.getTime()).toBe(limit)
    at(limit)
    expect(await refresh(r4.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
  })

  it('LT-06: replay detection on a migrated old chain is unchanged (legacy rotation judged from C)', async () => {
    const c = chains.get('oldreplay')!
    at(C.getTime() + 60_000)
    expect(await refresh(c.rootTok)).toEqual({ ok: false, code: 'SESSION_RACE' })
    expect(family(c)[0].revokedAt).toBeNull()
    const r = ok(await refresh(c.tailTok)) // live tail rotates
    at(C.getTime() + 60_001)
    expect(await refresh(c.rootTok)).toEqual({ ok: false, code: 'REFRESH_REUSED' })
    expect(family(c)[0].revokeReason).toBe('reuse')
    expect(await refresh(r.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' }) // whole family
  })

  it('LT-07: logout of a migrated chain revokes its family; a logged-out Phase 2 chain stays rejected', async () => {
    const c = chains.get('d61')!
    at(C.getTime() + 2 * MIN)
    expect(await endSession(client, { refreshToken: c.tailTok })).toEqual({ ok: true })
    expect(family(c)[0].revokeReason).toBe('logout')
    expect(await refresh(c.tailTok)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
    expect(await refresh(chains.get('oldout')!.tailTok)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
  })

  it('LT-08: new web and mobile logins after the cutover keep createdAt + 90 d; mobile binding unchanged', async () => {
    at(C.getTime() + DAY)
    sql(DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('lt_new','lt_new@test.local','x', now())`)
    const u = { id: 'lt_new', email: 'lt_new@test.local', name: null }
    for (const clientType of ['web', 'mobile'] as const) {
      const s = await startSession(client, u, { clientType })
      expect(s.sessionExpiresAt.getTime()).toBe(C.getTime() + DAY + 90 * DAY)
      expect(await refresh(s.refreshToken, clientType === 'web' ? 'mobile' : 'web')).toEqual({ ok: false, code: 'CLIENT_MISMATCH' })
      at(C.getTime() + DAY + 90 * DAY)
      expect(await refresh(s.refreshToken, clientType)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
      at(C.getTime() + DAY)
    }
  })

  it('LT-09: rollback caps legacy rows at their family limit; roll forward starts a new, equally bounded transition', async () => {
    setClock(DB, null)
    const c = chains.get('d59')!
    const limitBefore = absOf(c)
    const down = spawnSync(
      'psql',
      ['--single-transaction', '-X', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', DB, '-f', DOWN_SQL],
      { encoding: 'utf8' },
    )
    expect(down.status, `${down.stdout}${down.stderr}`).toBe(0)
    // Phase 2 reads only session rows: the transition limit is carried down
    expect(ms(`SELECT max("expiresAt") FROM "Session" WHERE "userId" = '${c.user}'`)).toBeLessThanOrEqual(limitBefore)
    expect(ms(`SELECT max("expiresAt") FROM "Session" WHERE "userId" = 'lt_old2'`)).toBeLessThanOrEqual(C.getTime() + 30 * DAY)
    // families revoked before the rollback (expired, reuse, logout) have no live row left
    const ended = ['lt_old', 'lt_old2', 'lt_oldreplay', 'lt_d61', 'lt_oldout']
    const liveEnded = sql(DB, `SELECT count(*) FROM "Session" WHERE "revokedAt" IS NULL AND "userId" IN ('lt_old2','lt_oldreplay','lt_d61','lt_oldout')`)
    expect(liveEnded).toBe('0')

    const full = migrationsDir()
    dirs.push(full)
    const r = await prisma(DB, full)
    expect(r.code, r.output).toBe(0)
    const C2 = ms(`SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
    expect(C2).toBeGreaterThan(C.getTime())
    // every family is re-derived from the new cutover with the same bounds
    const fams = rows<{ userId: string; created: string; abs: string; revokeReason: string | null }>(
      DB,
      `SELECT "userId", (extract(epoch FROM "createdAt") * 1000)::bigint::text AS created,
              (extract(epoch FROM "absoluteExpiresAt") * 1000)::bigint::text AS abs, "revokeReason" FROM "SessionFamily"`,
    )
    expect(fams.length).toBeGreaterThan(chains.size)
    for (const f of fams) {
      expect(Number(f.abs)).toBe(legacyAbsoluteExpiresAt(new Date(Number(f.created)), new Date(C2)).getTime())
      expect(Number(f.abs)).toBeLessThanOrEqual(C2 + 90 * DAY)
    }
    // revocation survives rollback + roll forward: ended chains come back revoked
    for (const u of ended.filter((x) => x !== 'lt_old')) {
      expect(fams.filter((f) => f.userId === u).every((f) => f.revokeReason === 'migrated'), u).toBe(true)
    }
    expect(fams.find((f) => f.userId === 'lt_old2')!.revokeReason).toBe('migrated')
    // a still-live legacy chain is usable after the roll forward
    setClock(DB, null)
    installTestClock(DB)
    const live = chains.get('d59')!
    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "userId" = '${live.user}' AND "revokedAt" IS NULL`)).toBe('1')
    const after = ok(await refresh(live.tailTok))
    expect(after.issued.sessionExpiresAt.getTime()).toBe(legacyAbsoluteExpiresAt(live.start, new Date(C2)).getTime())
  })
})
