/**
 * CHAIN: migration 20261006000300_session_families puts every existing session
 * into exactly one SessionFamily, keeps healthy chains working, revokes
 * inconsistent ones (revokeReason = 'anomaly'), and fails as a whole on
 * duplicate links.
 */
import { execFileSync } from 'child_process'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { legacyAbsoluteExpiresAt, preflightExitCode, preflightFamilies, type PreflightReport } from '@/server/session/maintenance'
import {
  createDb, dbUrl, dropDb, enabled, migrationRows, migrationsDir, MIGRATION_NAMES, prisma, rmDir, rows, seedUsers, snapshot, sql,
} from './pg'

const M4 = MIGRATION_NAMES.indexOf('20261006000300_session_families')
const BASE = 'itest_chain_base'

interface S {
  id: string
  user: string
  created: number // minutes after T0
  revoked?: number // minutes after T0
  next?: string
}

const T0 = '2026-09-01 10:00:00'
const ts = (m: number) => `(TIMESTAMP '${T0}' + interval '${m} minutes')`

function insertSessions(db: string, list: S[]) {
  const values = list
    .map(
      (s) =>
        `('${s.id}','${s.user}','h_${s.id}',${ts(s.created + 30 * 24 * 60)},${ts(s.created)},` +
        `${s.revoked === undefined ? 'NULL' : ts(s.revoked)},${s.next ? `'${s.next}'` : 'NULL'})`,
    )
    .join(',\n')
  // Session_userId_fkey forbids unknown users; dangling replacedById is allowed (no FK).
  sql(db, `INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById") VALUES ${values}`)
}

interface FamilyRow {
  id: string
  userId: string
  createdAt: string
  absoluteExpiresAt: string
  abs_ms: string
  revokedAt: string | null
  revokeReason: string | null
  members: string[]
}

function families(db: string): FamilyRow[] {
  return rows<FamilyRow>(
    db,
    `SELECT f."id", f."userId", f."createdAt"::text, f."absoluteExpiresAt"::text,
            (extract(epoch FROM f."absoluteExpiresAt") * 1000)::bigint::text AS abs_ms, f."revokedAt"::text, f."revokeReason",
            (SELECT json_agg(s."id" ORDER BY s."id") FROM "Session" s WHERE s."familyId" = f."id") AS members
       FROM "SessionFamily" f`,
  )
}

const cutover = (db: string) => sql(db, `SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
const cutoverDate = (db: string) =>
  new Date(Number(sql(db, `SELECT (extract(epoch FROM "value") * 1000)::bigint FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)))
const T0_MS = Date.parse(T0.replace(' ', 'T') + 'Z')

/** T0 + m minutes as PostgreSQL prints a whole-second timestamp(3). */
function pgTs(m: number) {
  const d = new Date(Date.parse(T0.replace(' ', 'T') + 'Z') + m * 60_000)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Independent model of the expected result for a set of components. */
function expectFamilies(db: string, comps: { members: S[]; cycle?: boolean }[]) {
  const got = families(db)
  const byMembers = new Map(got.map((f) => [f.members.join(','), f]))
  const sessions = new Map(
    rows<{ id: string; revokedAt: string | null; rotatedAt: string | null; rotatedAtSource: string | null }>(
      db,
      `SELECT "id", "revokedAt"::text, "rotatedAt"::text, "rotatedAtSource" FROM "Session"`,
    ).map((r) => [r.id, r]),
  )
  expect(got.length).toBe(comps.length)
  const cut = cutover(db)
  const cutAt = cutoverDate(db)
  const tally = { healthyLive: 0, migrated: 0, anomaly: 0 }
  for (const c of comps) {
    const ids = c.members.map((s) => s.id).sort()
    const fam = byMembers.get(ids.join(','))
    expect(fam, `family for ${ids.join(',')}`).toBeDefined()
    const byId = new Map(c.members.map((s) => [s.id, s]))
    const anomaly =
      c.cycle === true ||
      c.members.some((s) => {
        if (!s.next) return false
        const n = byId.get(s.next)
        return !n || n.user !== s.user || n.created < s.created || s.revoked === undefined
      }) ||
      c.members.some((s) => s.user !== c.members[0].user)
    const live = c.members.some((s) => s.revoked === undefined)
    const minCreated = Math.min(...c.members.map((s) => s.created))
    expect(fam!.createdAt).toBe(pgTs(minCreated))
    // legacy limit: LEAST(cutover + 90 d, GREATEST(chain start + 90 d, cutover + 30 d))
    expect(Number(fam!.abs_ms)).toBe(legacyAbsoluteExpiresAt(new Date(T0_MS + minCreated * 60_000), cutAt).getTime())
    if (anomaly) {
      tally.anomaly++
      expect(fam!.revokeReason).toBe('anomaly')
      expect(fam!.revokedAt).toBe(cut)
    } else if (!live) {
      tally.migrated++
      expect(fam!.revokeReason).toBe('migrated')
      expect(fam!.revokedAt).toBe(pgTs(Math.max(...c.members.map((s) => s.revoked!))))
      expect(fam!.userId).toBe(c.members[0].user)
    } else {
      tally.healthyLive++
      expect(fam!.revokeReason).toBeNull()
      expect(fam!.revokedAt).toBeNull()
      expect(fam!.userId).toBe(c.members[0].user)
    }
    for (const s of c.members) {
      const row = sessions.get(s.id)!
      if (s.revoked !== undefined) expect(row.revokedAt).toBe(pgTs(s.revoked))
      else if (anomaly) expect(row.revokedAt).toBe(cut)
      else expect(row.revokedAt).toBeNull()
      if (s.next) {
        expect(row.rotatedAtSource).toBe('legacy')
        expect(row.rotatedAt).toBe(row.revokedAt)
      } else {
        expect(row.rotatedAtSource).toBeNull()
        expect(row.rotatedAt).toBeNull()
      }
    }
  }
  return tally
}

/** Read-only preflight on the pre-migration database; asserts it changed nothing. */
async function preflight(db: string): Promise<PreflightReport> {
  const before = snapshot(db)
  const client = new PrismaClient({ datasourceUrl: dbUrl(db) })
  try {
    const report = await preflightFamilies(client)
    expect(snapshot(db)).toEqual(before)
    return report
  } finally {
    await client.$disconnect()
  }
}

/** The migration's actual outcome must equal what the preflight predicted. */
function expectPreflightMatches(db: string, report: PreflightReport) {
  const fams = families(db)
  const healthyLive = fams.filter((f) => f.revokeReason === null).length
  const migrated = fams.filter((f) => f.revokeReason === 'migrated').length
  const anomalous = fams.filter((f) => f.revokeReason === 'anomaly').map((f) => f.members.join(',')).sort()
  expect(report.components).toBe(fams.length)
  expect(report.planned).toEqual({ healthyLive, migratedRevoked: migrated, anomaly: anomalous.length })
  const transitionMs = cutoverDate(db).getTime() + 30 * 24 * 3600 * 1000
  const live = fams.filter((f) => f.revokeReason === null)
  expect(report.legacyLifetime.transition).toBe(live.filter((f) => Number(f.abs_ms) === transitionMs).length)
  expect(report.legacyLifetime.fromChainStart).toBe(live.filter((f) => Number(f.abs_ms) !== transitionMs).length)
  expect(report.anomalies.map((a) => [...a.sessionIds].sort().join(',')).sort()).toEqual(anomalous)
}

/** Phase 2 columns other than revokedAt are never changed. */
const LEGACY_COLS = `"id","userId","tokenHash","expiresAt","createdAt","lastUsedAt","replacedById","userAgent"`
const legacyView = (db: string) => sql(db, `SELECT ${LEGACY_COLS} FROM "Session" ORDER BY "id"`)

describe.skipIf(!enabled)('session_families migration — chain completeness', () => {
  const dirs: string[] = []
  let full = ''

  beforeAll(async () => {
    createDb(BASE)
    const before = migrationsDir(M4)
    dirs.push(before)
    const r = await prisma(BASE, before)
    expect(r.code, r.output).toBe(0)
    seedUsers(BASE, 3)
    full = migrationsDir()
    dirs.push(full)
  })

  afterAll(() => {
    dirs.forEach(rmDir)
    if (!process.env.ATLAS_ITEST_KEEP) for (const db of [BASE, 'itest_chain_cases', 'itest_chain_dup', 'itest_chain_fuzz', 'itest_chain_big']) dropDb(db)
  })

  it('CHAIN-01..09: assigns every shape to exactly one family', async () => {
    const db = 'itest_chain_cases'
    createDb(db, BASE)
    const comps: { members: S[]; cycle?: boolean }[] = [
      // 01 clean chain, live tail
      { members: [
        { id: 'a1', user: 'u1', created: 0, revoked: 10, next: 'a2' },
        { id: 'a2', user: 'u1', created: 10, revoked: 20, next: 'a3' },
        { id: 'a3', user: 'u1', created: 20 },
      ] },
      // 02 fully revoked chain (rotation, then logout)
      { members: [
        { id: 'b1', user: 'u1', created: 0, revoked: 5, next: 'b2' },
        { id: 'b2', user: 'u1', created: 5, revoked: 50 },
      ] },
      // 03 lone sessions, live and revoked
      { members: [{ id: 'c1', user: 'u2', created: 1 }] },
      { members: [{ id: 'c2', user: 'u2', created: 2, revoked: 3 }] },
      // 04 self-loop
      { cycle: true, members: [{ id: 'd1', user: 'u1', created: 0, revoked: 1, next: 'd1' }] },
      // 05 3-cycle with a live member
      { cycle: true, members: [
        { id: 'e1', user: 'u2', created: 0, revoked: 1, next: 'e2' },
        { id: 'e2', user: 'u2', created: 1, revoked: 2, next: 'e3' },
        { id: 'e3', user: 'u2', created: 2, next: 'e1' },
      ] },
      // 06 dangling link
      { members: [
        { id: 'f0', user: 'u1', created: 0, revoked: 1, next: 'f1' },
        { id: 'f1', user: 'u1', created: 1, revoked: 2, next: 'f_missing' },
      ] },
      // 07 user mismatch
      { members: [
        { id: 'g1', user: 'u1', created: 0, revoked: 1, next: 'g2' },
        { id: 'g2', user: 'u3', created: 1 },
      ] },
      // 08 timestamp inversion
      { members: [
        { id: 'h1', user: 'u3', created: 60, revoked: 61, next: 'h2' },
        { id: 'h2', user: 'u3', created: 0 },
      ] },
      // 09 live session that is not the tail
      { members: [
        { id: 'i1', user: 'u3', created: 0, next: 'i2' },
        { id: 'i2', user: 'u3', created: 1 },
      ] },
    ]
    insertSessions(db, comps.flatMap((c) => c.members))
    const legacyBefore = legacyView(db)
    const predicted = await preflight(db)
    expect(preflightExitCode(predicted)).toBe(2)
    expect(Object.fromEntries(predicted.anomalies.map((a) => [a.key, a.reasons]))).toEqual({
      'cycle:d1': ['cycle'],
      'cycle:e1': ['cycle', 'time_inversion', 'live_non_tail'], // e3 (live) → e1 (older)
      'root:f0': ['dangling_link'],
      'root:g1': ['user_mismatch'],
      'root:h1': ['time_inversion'],
      'root:i1': ['live_non_tail'],
    })
    expect(JSON.stringify(predicted)).not.toMatch(/h_[a-z]\d|@/) // ids only: no token hashes, no e-mails

    const r = await prisma(db, full)
    expect(r.code, r.output).toBe(0)

    expectFamilies(db, comps)
    expectPreflightMatches(db, predicted)
    expect(legacyView(db)).toBe(legacyBefore)
    expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')
    // healthy family owner = chain owner; cutover strictly after migration start
    expect(sql(db, `SELECT f."userId" FROM "SessionFamily" f JOIN "Session" s ON s."familyId" = f."id" WHERE s."id" = 'c1'`)).toBe('u2')
    expect(sql(db, `SELECT (SELECT "value" FROM "SystemMarker" WHERE "key"='legacyCutoverAt') > (SELECT "value" FROM "SystemMarker" WHERE "key"='migrationStartedAt')`)).toBe('t')
    expect(migrationRows(db).every((m) => m.finished && !m.rolled_back)).toBe(true)
    // atlas_now(): UTC wall clock at ms precision regardless of server TimeZone
    expect(sql(db, `SET TimeZone = 'Asia/Tashkent'; SELECT abs(extract(epoch FROM atlas_now() - (now() AT TIME ZONE 'UTC'))) < 0.001`)).toBe('t')
    expect(sql(db, `SELECT pg_typeof(atlas_now())::text`)).toBe('timestamp without time zone')
  })

  it('CHAIN-10: duplicate links fail the whole migration and change nothing', async () => {
    const db = 'itest_chain_dup'
    createDb(db, BASE)
    insertSessions(db, [
      { id: 'k1', user: 'u1', created: 0, revoked: 1, next: 'k3' },
      { id: 'k2', user: 'u1', created: 0, revoked: 1, next: 'k3' },
      { id: 'k3', user: 'u1', created: 1 },
      { id: 'k4', user: 'u2', created: 5 },
    ])
    const predicted = await preflight(db)
    expect(predicted.duplicateLinks).toEqual([{ replacedById: 'k3', predecessorIds: ['k1', 'k2'] }])
    expect(preflightExitCode(predicted)).toBe(3)
    // the CLI reports the same through its exit code
    const cli = (() => {
      try {
        execFileSync('bun', [path.resolve(__dirname, '../../scripts/session-cleanup.ts'), '--preflight-families', '--json'], {
          env: { ...process.env, DATABASE_URL: dbUrl(db) },
          encoding: 'utf8',
        })
        return { status: 0, stdout: '' }
      } catch (e) {
        const err = e as { status: number; stdout: string }
        return { status: err.status, stdout: err.stdout }
      }
    })()
    expect(cli.status).toBe(3)
    expect(JSON.parse(cli.stdout).duplicateLinks).toEqual(predicted.duplicateLinks)
    const before = snapshot(db)

    const r = await prisma(db, full)
    expect(r.code).not.toBe(0)
    expect(r.output).toMatch(/P3018/)
    expect(r.output).toMatch(/Session_replacedById_key|duplicate key|could not create unique index/)

    const after = snapshot(db)
    expect(after.schema).toBe(before.schema)
    expect(after.data).toBe(before.data)
    const m = migrationRows(db).find((x) => x.migration_name === '20261006000300_session_families')!
    expect(m).toMatchObject({ finished: false, rolled_back: false, steps: 0, has_logs: true })
    // and the pre-check query in docs/database/cutover.md finds the culprit
    expect(sql(db, `SELECT "replacedById", count(*) FROM "Session" WHERE "replacedById" IS NOT NULL GROUP BY 1 HAVING count(*) > 1`)).toBe('k3|2')
  })

  it('CHAIN-11: randomized shapes (300 sessions x 5 seeds) match an independent model', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      const db = 'itest_chain_fuzz'
      createDb(db, BASE)
      const rnd = mulberry32(seed)
      const comps: { members: S[]; cycle?: boolean }[] = []
      let n = 0
      while (n < 300) {
        const len = 1 + Math.floor(rnd() * 6)
        const cycle = rnd() < 0.1
        const dangling = !cycle && rnd() < 0.1
        const user = `u${1 + Math.floor(rnd() * 3)}`
        const members: S[] = []
        for (let i = 0; i < len; i++) {
          const id = `z${seed}_${n + i}`
          const isTail = i === len - 1
          const created = i * 10 + (rnd() < 0.05 ? -100 : 0)
          const revoked = !isTail || cycle || dangling ? (rnd() < 0.05 ? undefined : created + 5) : rnd() < 0.5 ? undefined : created + 7
          members.push({
            id,
            user: rnd() < 0.05 ? `u${1 + Math.floor(rnd() * 3)}` : user,
            created,
            revoked,
            next: !isTail ? `z${seed}_${n + i + 1}` : cycle ? `z${seed}_${n}` : dangling ? `missing_${id}` : undefined,
          })
        }
        comps.push({ members, cycle })
        n += len
      }
      // insert in shuffled order so physical order does not follow chains
      const all = comps.flatMap((c) => c.members)
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[all[i], all[j]] = [all[j], all[i]]
      }
      insertSessions(db, all)
      const legacyBefore = legacyView(db)
      const predicted = await preflight(db)
      const r = await prisma(db, full)
      expect(r.code, r.output).toBe(0)
      const tally = expectFamilies(db, comps)
      expectPreflightMatches(db, predicted)
      console.log(`CHAIN-11 seed ${seed}: ${all.length} sessions, ${comps.length} families`, tally)
      expect(tally.anomaly).toBeGreaterThan(0)
      expect(tally.healthyLive).toBeGreaterThan(0)
      expect(tally.migrated).toBeGreaterThan(0)
      expect(legacyView(db)).toBe(legacyBefore)
    }
  })

  it('CHAIN-12: 100k sessions incl. one 20k-long chain migrate in one pass', async () => {
    const db = 'itest_chain_big'
    createDb(db, BASE)
    // 8000 chains of 10 (live tails) + one chain of 20000
    sql(db, `
      INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById")
      SELECT 'c' || c || '_' || i, 'u' || (1 + c % 3), 'h' || c || '_' || i,
             TIMESTAMP '${T0}' + interval '30 days', TIMESTAMP '${T0}' + i * interval '1 minute',
             CASE WHEN i < 9 THEN TIMESTAMP '${T0}' + (i + 1) * interval '1 minute' END,
             CASE WHEN i < 9 THEN 'c' || c || '_' || (i + 1) END
        FROM generate_series(0, 7999) c, generate_series(0, 9) i;
      INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById")
      SELECT 'L' || i, 'u1', 'hL' || i,
             TIMESTAMP '${T0}' + interval '30 days', TIMESTAMP '${T0}' + i * interval '1 second',
             CASE WHEN i < 19999 THEN TIMESTAMP '${T0}' + (i + 1) * interval '1 second' END,
             CASE WHEN i < 19999 THEN 'L' || (i + 1) END
        FROM generate_series(0, 19999) i;`)
    const started = Date.now()
    const r = await prisma(db, full)
    const ms = Date.now() - started
    expect(r.code, r.output).toBe(0)
    console.log(`CHAIN-12: migrate deploy (100000 sessions) took ${ms} ms`)
    expect(sql(db, `SELECT count(*) FROM "SessionFamily"`)).toBe('8001')
    expect(sql(db, `SELECT count(*) FROM "SessionFamily" WHERE "revokeReason" IS NOT NULL`)).toBe('0')
    expect(sql(db, `SELECT count(DISTINCT "familyId") FROM "Session" WHERE "id" LIKE 'L%'`)).toBe('1')
    expect(sql(db, `SELECT max(n) || ',' || min(n) FROM (SELECT count(*) n FROM "Session" WHERE "id" LIKE 'c%' GROUP BY "familyId") x`)).toBe('10,10')
  })
})

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
