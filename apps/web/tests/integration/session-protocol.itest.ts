/**
 * Session protocol against real PostgreSQL: rotation, grace replay, reuse,
 * absolute expiry, client binding, revocation stamping, legacy cutover rules
 * and forced concurrency. Two PrismaClients stand in for two app instances.
 * Time comes from the database test clock (see installTestClock); waits are
 * condition-based (pg_stat_activity), never sleeps.
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashToken, verifyAccessToken } from '@/lib/auth'
import { getSessionEncKeys } from '@/lib/config'
import { endSession, refreshSession, startSession, type ClientType, type RefreshResult } from '@/server/session/protocol'
import { encryptSuccessor, successorAad } from '@/server/session/successor-crypto'
import {
  APP_DB, createDb, dbUrl, dropDb, enabled, migrationsDir, prisma as prismaCli, psqlSession, rmDir, pgText, rows, setClock, sql, sqlTimestamp, waitFor,
} from './pg'

const DB = APP_DB
const DAY = 24 * 3600 * 1000

describe.skipIf(!enabled)('session protocol (real PostgreSQL)', () => {
  let a: PrismaClient
  let b: PrismaClient
  let T0: Date
  let seq = 0
  const at = (ms: number) => new Date(T0.getTime() + ms)
  const clock = (ms: number) => setClock(DB, at(ms))

  beforeAll(async () => {
    a = new PrismaClient({ datasourceUrl: dbUrl(DB) })
    b = new PrismaClient({ datasourceUrl: dbUrl(DB) })
    await Promise.all([a.$connect(), b.$connect()])
  })
  afterAll(async () => {
    setClock(DB, null)
    await Promise.all([a.$disconnect(), b.$disconnect()])
  })
  beforeEach(() => {
    // whole seconds, close to real time so JWTs verify against the system clock
    T0 = new Date(Math.floor(Date.now() / 1000) * 1000)
    clock(0)
  })

  function newUser() {
    const id = `pu_${process.pid}_${++seq}`
    sql(DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
    return { id, email: `${id}@test.local`, name: null }
  }

  async function login(clientType: ClientType = 'web', client = a) {
    const user = newUser()
    const issued = await startSession(client, user, { clientType, deviceName: clientType === 'mobile' ? 'Pixel 9' : null })
    return { user, ...issued }
  }

  const refresh = (token: string, clientType: ClientType = 'web', client = a) => refreshSession(client, token, { clientType })

  function ok(r: RefreshResult) {
    if (!r.ok) throw new Error(`expected success, got ${r.code}`)
    return r
  }

  function familyState(familyId: string) {
    return rows<{ revokedAt: string | null; revokeReason: string | null }>(
      DB,
      `SELECT "revokedAt"::text, "revokeReason" FROM "SessionFamily" WHERE "id" = '${familyId}'`,
    )[0]
  }

  function sessions(familyId: string) {
    return rows<{ id: string; revokedAt: string | null; replacedById: string | null; rotatedAtSource: string | null; enc: boolean }>(
      DB,
      `SELECT "id", "revokedAt"::text, "replacedById", "rotatedAtSource", "successorTokenEnc" IS NOT NULL AS enc
         FROM "Session" WHERE "familyId" = '${familyId}' ORDER BY "createdAt", "id"`,
    )
  }

  const liveCount = (familyId: string) => sessions(familyId).filter((s) => s.revokedAt === null).length

  /** Full dump of one family and its sessions (before/after comparisons). */
  const dumpFamily = (familyId: string) =>
    sql(
      DB,
      `SELECT json_build_object('f', (SELECT row_to_json(f) FROM "SessionFamily" f WHERE f."id" = '${familyId}'),
                                's', (SELECT json_agg(s ORDER BY s."id") FROM "Session" s WHERE s."familyId" = '${familyId}'))`,
    )

  /** A connection holding the family row lock until release(). */
  async function holdFamilyLock(familyId: string) {
    const holder = psqlSession(DB, 'itest_lockholder')
    holder.send(`BEGIN; SELECT 1 FROM "SessionFamily" WHERE "id" = '${familyId}' FOR UPDATE; SELECT 'locked';`)
    await waitFor(() => holder.output().includes('locked'), 'lock holder')
    return {
      release: async () => {
        holder.send('COMMIT;')
        holder.end()
        expect(await holder.done).toBe(0)
      },
    }
  }

  const waitingOnLocks = () =>
    Number(sql(DB, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`))

  async function waitForWaiters(n: number) {
    await waitFor(() => waitingOnLocks() >= n, `${n} request(s) blocked on the family lock`, 10_000)
  }

  // ─── Rotation and grace ───────────────────────────────────────────────────

  it('ROT-01: login creates a family (90-day limit); refresh rotates within it and stores the successor encrypted', async () => {
    const s = await login()
    expect(s.sessionExpiresAt.getTime()).toBe(T0.getTime() + 90 * DAY)
    expect(s.refreshTokenExpiresAt.getTime()).toBe(T0.getTime() + 30 * DAY)
    expect(s.accessTokenExpiresAt.getTime()).toBe(T0.getTime() + 15 * 60 * 1000)
    const fam = rows<{ clientType: string; absoluteExpiresAt: string; createdAt: string }>(
      DB,
      `SELECT "clientType", "absoluteExpiresAt"::text, "createdAt"::text FROM "SessionFamily" WHERE "id" = '${s.familyId}'`,
    )[0]
    expect(fam).toEqual({ clientType: 'web', absoluteExpiresAt: pgText(at(90 * DAY)), createdAt: pgText(T0) })

    clock(1000)
    const r = ok(await refresh(s.refreshToken))
    expect(r.replay).toBe(false)
    expect(r.issued.refreshToken).not.toBe(s.refreshToken)
    expect(r.issued.familyId).toBe(s.familyId)
    expect((await verifyAccessToken(r.issued.accessToken)).sid).toBe(r.issued.sessionId)
    const [old, cur] = sessions(s.familyId)
    expect(old).toMatchObject({ id: s.sessionId, replacedById: r.issued.sessionId, rotatedAtSource: 'db', enc: true })
    expect(old.revokedAt).toBe(pgText(at(1000)))
    expect(cur).toMatchObject({ id: r.issued.sessionId, revokedAt: null, enc: false })
    const stored = sql(DB, `SELECT "successorTokenEnc" FROM "Session" WHERE "id" = '${s.sessionId}'`)
    expect(stored).not.toContain(r.issued.refreshToken)
    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "tokenHash" = '${hashToken(r.issued.refreshToken)}'`)).toBe('1')
  })

  it('BND-02: replay at request-start Δ = 60 000 ms is grace — same refresh token, new access token, nothing rotated', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    clock(60_000)
    const r2 = ok(await refresh(s.refreshToken))
    expect(r2.replay).toBe(true)
    expect(r2.issued.refreshToken).toBe(r1.issued.refreshToken)
    expect(r2.issued.sessionId).toBe(r1.issued.sessionId)
    expect(r2.issued.accessToken).not.toBe(r1.issued.accessToken)
    expect(r2.issued.accessTokenExpiresAt.getTime()).toBe(at(60_000).getTime() + 15 * 60 * 1000)
    expect(liveCount(s.familyId)).toBe(1)
    expect(sessions(s.familyId)).toHaveLength(2)
  })

  it('BND-03: replay at request-start Δ = 60 001 ms is reuse — family revoked, successor rejected', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    clock(60_001)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'REFRESH_REUSED' })
    expect(familyState(s.familyId)).toEqual({ revokedAt: pgText(at(60_001)), revokeReason: 'reuse' })
    expect(liveCount(s.familyId)).toBe(0)
    expect(sessions(s.familyId).every((x) => !x.enc)).toBe(true)
    expect(await refresh(r1.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
  })

  it('BND-04: replay started at Δ = 59 000 but held on the family lock past Δ = 65 000 stays grace', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    const lock = await holdFamilyLock(s.familyId)
    clock(59_000)
    const pending = refresh(s.refreshToken, 'web', b)
    await waitForWaiters(1) // it has read t_req and is waiting for the lock
    clock(65_000)
    await lock.release()
    const r2 = ok(await pending)
    expect(r2.replay).toBe(true)
    expect(r2.issued.refreshToken).toBe(r1.issued.refreshToken)
  })

  it('BND-05: replay started at Δ = 61 000 with no contention is reuse', async () => {
    const s = await login()
    ok(await refresh(s.refreshToken))
    clock(61_000)
    expect((await refresh(s.refreshToken)).ok).toBe(false)
    expect(familyState(s.familyId).revokeReason).toBe('reuse')
  })

  it('BND-06 / AT-03: replay (Δ 59 000) then reuse (Δ 61 000) — tokens issued, then the family is revoked and they stop working', async () => {
    const s = await login()
    ok(await refresh(s.refreshToken))
    clock(59_000)
    const x = ok(await refresh(s.refreshToken))
    clock(61_000)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'REFRESH_REUSED' })
    expect(await refresh(x.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
  })

  it('BND-07 / AT-04: reuse first (Δ 61 000), then an earlier-started replay (Δ 59 000) gets 401 and no tokens', async () => {
    const s = await login()
    ok(await refresh(s.refreshToken))
    clock(61_000)
    expect((await refresh(s.refreshToken)).ok).toBe(false)
    clock(59_000)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
  })

  it('BND-08: replay (Δ 59 000) and reuse (Δ 61 000) both waiting on the lock — family always ends revoked (50×)', async () => {
    for (let i = 0; i < 50; i++) {
      T0 = new Date(Math.floor(Date.now() / 1000) * 1000)
      clock(0)
      const s = await login()
      ok(await refresh(s.refreshToken))
      const lock = await holdFamilyLock(s.familyId)
      clock(59_000)
      const x = refresh(s.refreshToken, 'web', i % 2 ? a : b)
      await waitForWaiters(1)
      clock(61_000)
      const y = refresh(s.refreshToken, 'web', i % 2 ? b : a)
      await waitForWaiters(2)
      await lock.release()
      const [rx, ry] = await Promise.all([x, y])
      expect(ry).toEqual({ ok: false, code: 'REFRESH_REUSED' })
      expect(familyState(s.familyId).revokeReason).toBe('reuse')
      expect(liveCount(s.familyId)).toBe(0)
      if (rx.ok) expect(await refresh(rx.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
      else expect(rx.code).toBe('SESSION_REVOKED')
    }
  })

  it('GRACE-02: a stored ciphertext that decrypts but does not match the successor hash → SESSION_RACE, no tokens', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    const forged = encryptSuccessor(crypto.randomBytes(32).toString('base64url'), successorAad(s.sessionId, r1.issued.sessionId), getSessionEncKeys())
    sql(DB, `UPDATE "Session" SET "successorTokenEnc" = '${forged}' WHERE "id" = '${s.sessionId}'`)
    clock(1000)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_RACE' })
    // a ciphertext copied from another row (wrong AAD) is refused the same way
    const other = await login()
    const o1 = ok(await refresh(other.refreshToken))
    const otherEnc = sql(DB, `SELECT "successorTokenEnc" FROM "Session" WHERE "id" = '${other.sessionId}'`)
    sql(DB, `UPDATE "Session" SET "successorTokenEnc" = '${otherEnc}' WHERE "id" = '${s.sessionId}'`)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_RACE' })
    expect(o1.ok && familyState(s.familyId).revokedAt).toBeNull()
  })

  it('GRACE-03: no replay once the successor itself has rotated (the chain moved on) → SESSION_RACE', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    ok(await refresh(r1.issued.refreshToken))
    clock(1000)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_RACE' })
    expect(familyState(s.familyId).revokedAt).toBeNull()
  })

  // ─── Concurrency ──────────────────────────────────────────────────────────

  it('AT-01: 5 concurrent refreshes of one token over two instances → exactly one rotation, 5 identical refresh tokens (50×)', async () => {
    for (let i = 0; i < 50; i++) {
      const s = await login()
      const lock = await holdFamilyLock(s.familyId)
      const pending = [a, b, a, b, a].map((c) => refresh(s.refreshToken, 'web', c))
      await waitForWaiters(5)
      await lock.release()
      const results = (await Promise.all(pending)).map(ok)
      expect(results.filter((r) => !r.replay)).toHaveLength(1)
      expect(new Set(results.map((r) => r.issued.refreshToken)).size).toBe(1)
      const successor = results[0].issued.sessionId
      for (const r of results) expect((await verifyAccessToken(r.issued.accessToken)).sid).toBe(successor)
      expect(liveCount(s.familyId)).toBe(1)
      expect(familyState(s.familyId).revokedAt).toBeNull()
    }
  })

  it('AT-02: a request waiting > 5 s on the family lock gets SESSION_BUSY with no side effects; < 5 s takes the grace path', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    const before = dumpFamily(s.familyId)

    const lock = await holdFamilyLock(s.familyId)
    const started = Date.now()
    const busy = await refresh(s.refreshToken, 'web', b)
    const waited = Date.now() - started
    await lock.release()
    expect(busy).toEqual({ ok: false, code: 'SESSION_BUSY' })
    expect(waited).toBeGreaterThanOrEqual(4_900)
    expect(dumpFamily(s.familyId)).toBe(before)

    const lock2 = await holdFamilyLock(s.familyId)
    const pending = refresh(s.refreshToken, 'web', b)
    await waitForWaiters(1)
    await lock2.release()
    const r2 = ok(await pending)
    expect(r2.replay).toBe(true)
    expect(r2.issued.refreshToken).toBe(r1.issued.refreshToken)
    expect(familyState(s.familyId).revokedAt).toBeNull()
  })

  it('AT-05: a rotation and a reuse queued on one family leave no live session, whatever the lock order (50×)', async () => {
    for (let i = 0; i < 50; i++) {
      T0 = new Date(Math.floor(Date.now() / 1000) * 1000)
      clock(0)
      const s = await login()
      const r1 = ok(await refresh(s.refreshToken)) // s rotated at Δ 0; r1 is the live tail
      clock(61_000)
      const lock = await holdFamilyLock(s.familyId)
      const first = i % 2 ? refresh(r1.issued.refreshToken, 'web', a) : refresh(s.refreshToken, 'web', b)
      await waitForWaiters(1)
      const second = i % 2 ? refresh(s.refreshToken, 'web', b) : refresh(r1.issued.refreshToken, 'web', a)
      await waitForWaiters(2)
      await lock.release()
      await Promise.all([first, second])
      expect(familyState(s.familyId).revokeReason).toBe('reuse')
      expect(liveCount(s.familyId)).toBe(0)
    }
  })

  it('AT-06: reuse in family A revokes all of A and leaves family B of the same user working', async () => {
    const s = await login()
    const otherDevice = await startSession(a, s.user, { clientType: 'web' })
    ok(await refresh(s.refreshToken))
    clock(61_000)
    expect((await refresh(s.refreshToken)).ok).toBe(false)
    expect(familyState(s.familyId).revokeReason).toBe('reuse')
    expect(familyState(otherDevice.familyId).revokedAt).toBeNull()
    expect(ok(await refresh(otherDevice.refreshToken)).replay).toBe(false)
  })

  it('AT-07: key rotation — stage, switch, retire: replays keep working; removing an unstaged key fails closed (SESSION_RACE)', async () => {
    const env = process.env as Record<string, string | undefined>
    const saved = { key: env.SESSION_ENC_KEY, dec: env.SESSION_ENC_DECRYPT_KEYS }
    const k1 = crypto.randomBytes(32).toString('base64')
    const k2 = crypto.randomBytes(32).toString('base64')
    const instance = (key: string, dec?: string) => {
      env.SESSION_ENC_KEY = key
      if (dec) env.SESSION_ENC_DECRYPT_KEYS = dec
      else delete env.SESSION_ENC_DECRYPT_KEYS
    }
    try {
      // 1. stage: K1 active everywhere, K2 decrypt-only
      instance(k1, k2)
      const s1 = await login()
      const r1 = ok(await refresh(s1.refreshToken)) // encrypted with K1
      // 2. switch: K2 active on instance B, K1 decrypt-only; instance A still K1 + K2 staged
      instance(k2, k1)
      const s2 = await login()
      const r2 = ok(await refresh(s2.refreshToken)) // encrypted with K2 on "B"
      instance(k1, k2) // "A"
      expect(ok(await refresh(s2.refreshToken)).issued.refreshToken).toBe(r2.issued.refreshToken)
      instance(k2, k1) // "B"
      expect(ok(await refresh(s1.refreshToken)).issued.refreshToken).toBe(r1.issued.refreshToken)
      // 3. retire K1 (after the grace window): K2-encrypted replays still work
      instance(k2)
      expect(ok(await refresh(s2.refreshToken)).issued.refreshToken).toBe(r2.issued.refreshToken)
      // unstaged removal: a K1 ciphertext with only K2 configured → SESSION_RACE, nothing revoked
      expect(await refresh(s1.refreshToken)).toEqual({ ok: false, code: 'SESSION_RACE' })
      expect(familyState(s1.familyId).revokedAt).toBeNull()
      expect(liveCount(s1.familyId)).toBe(1)
    } finally {
      env.SESSION_ENC_KEY = saved.key
      if (saved.dec === undefined) delete env.SESSION_ENC_DECRYPT_KEYS
      else env.SESSION_ENC_DECRYPT_KEYS = saved.dec
    }
  })

  // ─── Expiry, client binding, revocation stamping ──────────────────────────

  it('absolute limit: access token and refresh expiry are capped at the family limit; at the limit → SESSION_EXPIRED + family revoked', async () => {
    const s = await login()
    sql(DB, `UPDATE "SessionFamily" SET "absoluteExpiresAt" = TIMESTAMP '${sqlTimestamp(at(5 * 60_000))}' WHERE "id" = '${s.familyId}'`)
    clock(1000)
    const r = ok(await refresh(s.refreshToken))
    expect(r.issued.accessTokenExpiresAt.getTime()).toBe(at(5 * 60_000).getTime())
    expect((await verifyAccessToken(r.issued.accessToken)) && JSON.parse(Buffer.from(r.issued.accessToken.split('.')[1], 'base64url').toString()).exp).toBe(
      at(5 * 60_000).getTime() / 1000,
    )
    expect(r.issued.refreshTokenExpiresAt.getTime()).toBe(at(5 * 60_000).getTime())
    clock(5 * 60_000)
    expect(await refresh(r.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
    expect(familyState(s.familyId)).toEqual({ revokedAt: pgText(at(5 * 60_000)), revokeReason: 'expired' })
    expect(liveCount(s.familyId)).toBe(0) // FAM-STAMP-03
  })

  it('session expiry (30 days without refresh) → SESSION_EXPIRED; the family is revoked', async () => {
    const s = await login()
    clock(30 * DAY)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
    expect(familyState(s.familyId).revokeReason).toBe('expired')
  })

  it('AUTH-03: a token used in the other client mode → CLIENT_MISMATCH, nothing changed', async () => {
    const web = await login('web')
    const mob = await login('mobile')
    const before = [dumpFamily(web.familyId), dumpFamily(mob.familyId)]
    expect(await refresh(web.refreshToken, 'mobile')).toEqual({ ok: false, code: 'CLIENT_MISMATCH' })
    expect(await refresh(mob.refreshToken, 'web')).toEqual({ ok: false, code: 'CLIENT_MISMATCH' })
    expect([dumpFamily(web.familyId), dumpFamily(mob.familyId)]).toEqual(before)
    const r = ok(await refresh(mob.refreshToken, 'mobile'))
    expect(sql(DB, `SELECT "deviceName" FROM "Session" WHERE "id" = '${r.issued.sessionId}'`)).toBe('Pixel 9')
  })

  it('FAM-STAMP-01: logout revokes the family and stamps every live session in it; idempotent; by sid too', async () => {
    const s = await login()
    const r = ok(await refresh(s.refreshToken))
    // an extra live row in the same family (stamping must cover every live row)
    sql(
      DB,
      `INSERT INTO "Session" ("id","userId","familyId","tokenHash","expiresAt","createdAt")
       VALUES ('extra_${s.sessionId}','${s.user.id}','${s.familyId}','${crypto.randomBytes(16).toString('hex')}', now() + interval '1 day', now() AT TIME ZONE 'UTC')`,
    )
    clock(5000)
    expect(await endSession(a, { refreshToken: r.issued.refreshToken })).toEqual({ ok: true })
    expect(familyState(s.familyId)).toEqual({ revokedAt: pgText(at(5000)), revokeReason: 'logout' })
    expect(liveCount(s.familyId)).toBe(0)
    expect(sessions(s.familyId).every((x) => !x.enc)).toBe(true)
    expect(await endSession(a, { refreshToken: r.issued.refreshToken })).toEqual({ ok: true })
    expect(await refresh(r.issued.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
    // an old (rotated) token of a logged-out family is not "reuse": nothing else is touched
    clock(10 * 60_000)
    expect(await refresh(s.refreshToken)).toEqual({ ok: false, code: 'SESSION_REVOKED' })
    expect(familyState(s.familyId).revokeReason).toBe('logout')

    const t = await login()
    expect(await endSession(a, { sid: t.sessionId, userId: 'someone_else' })).toEqual({ ok: true })
    expect(familyState(t.familyId).revokedAt).toBeNull() // sid is scoped to its user
    expect(await endSession(a, { sid: t.sessionId, userId: t.user.id })).toEqual({ ok: true })
    expect(familyState(t.familyId).revokeReason).toBe('logout')
    expect(await endSession(a, {})).toEqual({ ok: true })
  })

  it('FAM-STAMP-02: reuse stamps every live session of the family, including one created by a concurrent rotation', async () => {
    const s = await login()
    const r1 = ok(await refresh(s.refreshToken))
    clock(61_000)
    const lock = await holdFamilyLock(s.familyId)
    const rotation = refresh(r1.issued.refreshToken, 'web', a)
    await waitForWaiters(1)
    const reuse = refresh(s.refreshToken, 'web', b)
    await waitForWaiters(2)
    await lock.release()
    await Promise.all([rotation, reuse])
    expect(liveCount(s.familyId)).toBe(0)
  })

  it('unknown, empty or oversized tokens → INVALID_TOKEN without touching the database state', async () => {
    expect(await refresh('')).toEqual({ ok: false, code: 'INVALID_TOKEN' })
    expect(await refresh('x'.repeat(129))).toEqual({ ok: false, code: 'INVALID_TOKEN' })
    expect(await refresh(crypto.randomBytes(32).toString('base64url'))).toEqual({ ok: false, code: 'INVALID_TOKEN' })
  })

  // ─── Legacy rows (migrated from Phase 2) ──────────────────────────────────

  describe('legacy cutover rules', () => {
    let savedCutover = ''
    beforeEach(() => {
      savedCutover = sql(DB, `SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
    })
    afterEach(() => {
      sql(DB, `UPDATE "SystemMarker" SET "value" = TIMESTAMP '${savedCutover}' WHERE "key" = 'legacyCutoverAt'`)
    })

    /** A migrated chain: old (rotated, legacy) → tail (live), with known tokens. */
    function legacyChain(rotatedAt: string) {
      const user = newUser()
      const fam = `lf_${user.id}`
      const [oldTok, tailTok] = [crypto.randomBytes(32).toString('base64url'), crypto.randomBytes(32).toString('base64url')]
      sql(
        DB,
        `INSERT INTO "SessionFamily" ("id","userId","clientType","createdAt","absoluteExpiresAt")
           VALUES ('${fam}','${user.id}','web', TIMESTAMP '${sqlTimestamp(at(-DAY))}', TIMESTAMP '${sqlTimestamp(at(89 * DAY))}');
         INSERT INTO "Session" ("id","userId","familyId","tokenHash","expiresAt","createdAt","revokedAt","replacedById","rotatedAt","rotatedAtSource")
           VALUES ('${fam}_tail','${user.id}','${fam}','${hashToken(tailTok)}', TIMESTAMP '${sqlTimestamp(at(20 * DAY))}', TIMESTAMP '${sqlTimestamp(at(-DAY + 1000))}', NULL, NULL, NULL, NULL),
                  ('${fam}_old','${user.id}','${fam}','${hashToken(oldTok)}', TIMESTAMP '${sqlTimestamp(at(20 * DAY))}', TIMESTAMP '${sqlTimestamp(at(-DAY))}',
                   ${rotatedAt}, '${fam}_tail', ${rotatedAt}, 'legacy');`,
      )
      return { fam, oldTok, tailTok }
    }

    it('LEG-01: a legacy rotated token at M + 60 000 → SESSION_RACE (nothing revoked); at M + 60 001 → REFRESH_REUSED; its rotatedAt is ignored', async () => {
      const M = at(0)
      sql(DB, `UPDATE "SystemMarker" SET "value" = TIMESTAMP '${sqlTimestamp(M)}' WHERE "key" = 'legacyCutoverAt'`)
      for (const rotatedAt of [`TIMESTAMP '2000-01-01 00:00:00'`, `TIMESTAMP '2999-01-01 00:00:00'`, `TIMESTAMP '${sqlTimestamp(at(-1000))}'`]) {
        const c = legacyChain(rotatedAt)
        clock(60_000)
        expect(await refresh(c.oldTok)).toEqual({ ok: false, code: 'SESSION_RACE' })
        expect(familyState(c.fam).revokedAt).toBeNull()
        expect(liveCount(c.fam)).toBe(1)
        clock(60_001)
        expect(await refresh(c.oldTok)).toEqual({ ok: false, code: 'REFRESH_REUSED' })
        expect(familyState(c.fam).revokeReason).toBe('reuse')
        expect(liveCount(c.fam)).toBe(0)
      }
    })

    it('LEG-02: a legacy live tail rotates normally; a replay of it then gets the grace path', async () => {
      sql(DB, `UPDATE "SystemMarker" SET "value" = TIMESTAMP '${sqlTimestamp(at(-DAY))}' WHERE "key" = 'legacyCutoverAt'`)
      const c = legacyChain(`TIMESTAMP '${sqlTimestamp(at(-DAY + 500))}'`)
      const r = ok(await refresh(c.tailTok))
      expect(r.replay).toBe(false)
      clock(30_000)
      const replay = ok(await refresh(c.tailTok))
      expect(replay.replay).toBe(true)
      expect(replay.issued.refreshToken).toBe(r.issued.refreshToken)
    })
  })

  // ─── Real clock (no test clock) ───────────────────────────────────────────

  it('SMOKE-01 (real-clock smoke, not a boundary proof): production atlas_now(); rotatedAt now−59 s → grace, now−61 s → reuse', async () => {
    const smokeDb = 'itest_smoke'
    createDb(smokeDb)
    const dir = migrationsDir()
    try {
      const r = await prismaCli(smokeDb, dir)
      expect(r.code, r.output).toBe(0)
      sql(smokeDb, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('su','su@test.local','x', now())`)
      const c = new PrismaClient({ datasourceUrl: dbUrl(smokeDb) })
      try {
        const user = { id: 'su', email: 'su@test.local', name: null }
        for (const [offset, expected] of [['59 seconds', 'grace'], ['61 seconds', 'reuse']] as const) {
          const s = await startSession(c, user, { clientType: 'web' })
          ok(await refreshSession(c, s.refreshToken, { clientType: 'web' }))
          sql(smokeDb, `UPDATE "Session" SET "rotatedAt" = date_trunc('milliseconds', now() AT TIME ZONE 'UTC') - interval '${offset}' WHERE "id" = '${s.sessionId}'`)
          const replay = await refreshSession(c, s.refreshToken, { clientType: 'web' })
          if (expected === 'grace') expect(replay.ok && replay.replay).toBe(true)
          else expect(replay).toEqual({ ok: false, code: 'REFRESH_REUSED' })
        }
        // the issued rows carry UTC wall-clock times although the server TimeZone is not UTC
        expect(sql(smokeDb, `SHOW TimeZone`)).not.toBe('UTC')
        expect(Number(sql(smokeDb, `SELECT abs(extract(epoch FROM max("createdAt") - (now() AT TIME ZONE 'UTC'))) FROM "SessionFamily"`))).toBeLessThan(60)
      } finally {
        await c.$disconnect()
      }
    } finally {
      rmDir(dir)
      if (!process.env.ATLAS_ITEST_KEEP) dropDb(smokeDb)
    }
  })
})
