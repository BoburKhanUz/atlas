/** CLEANUP: scripts/session-cleanup.ts logic (dry run by default) on its own test database. */
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupSessions } from '@/server/session/maintenance'
import { refreshSession, startSession, endSession } from '@/server/session/protocol'
import { createDb, dbUrl, dropDb, enabled, installTestClock, migrationsDir, prisma, rmDir, setClock, snapshot, sql } from './pg'

const DB = 'itest_maint'
const DAY = 86_400_000

describe.skipIf(!enabled)('session cleanup', () => {
  let client: PrismaClient
  beforeAll(async () => {
    createDb(DB)
    const dir = migrationsDir()
    const r = await prisma(DB, dir)
    rmDir(dir)
    expect(r.code, r.output).toBe(0)
    installTestClock(DB)
    client = new PrismaClient({ datasourceUrl: dbUrl(DB) })
  })
  afterAll(async () => {
    await client?.$disconnect()
    if (!process.env.ATLAS_ITEST_KEEP) dropDb(DB)
  })

  it('CLEANUP-01: dry run changes nothing; --apply clears stale ciphertexts and deletes only rows dead for > 30 days', async () => {
    const T0 = new Date(Math.floor(Date.now() / 1000) * 1000)
    const at = (ms: number) => new Date(T0.getTime() + ms)
    setClock(DB, at(0))
    sql(DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('mu','mu@test.local','x', now())`)
    const user = { id: 'mu', email: 'mu@test.local', name: null }
    const ok = <T extends { ok: boolean }>(r: T) => {
      expect(r.ok).toBe(true)
      return r as Extract<T, { ok: true }>
    }

    // live family rotated at Δ0, Δ25 and Δ50 days (each before its 30-day session expiry);
    // cleanup runs at Δ61: the Δ0 and Δ25 rotated rows are > 30 days old, the Δ50 one is not
    const live = await startSession(client, user, { clientType: 'web' })
    const l1 = ok(await refreshSession(client, live.refreshToken, { clientType: 'web' }))
    setClock(DB, at(25 * DAY))
    const l2 = ok(await refreshSession(client, l1.issued.refreshToken, { clientType: 'web' }))
    setClock(DB, at(50 * DAY))
    const l3 = ok(await refreshSession(client, l2.issued.refreshToken, { clientType: 'web' }))
    // logged-out family (revoked at Δ0) and a recently logged-out one
    setClock(DB, at(0))
    const oldOut = await startSession(client, user, { clientType: 'web' })
    await endSession(client, { refreshToken: oldOut.refreshToken })
    setClock(DB, at(40 * DAY))
    const recentOut = await startSession(client, user, { clientType: 'web' })
    await endSession(client, { refreshToken: recentOut.refreshToken })

    setClock(DB, at(61 * DAY))
    const before = snapshot(DB)
    const dry = await cleanupSessions(client, { apply: false })
    expect(snapshot(DB)).toEqual(before)
    expect(dry).toEqual({
      applied: false,
      successorCiphertextsCleared: 3, // all three rotations are > 60 s old
      rotatedSessionsDeleted: 2, // the rows rotated at Δ0 and Δ25
      familiesDeleted: 1, // oldOut (revoked 61 days ago); recentOut was revoked 21 days ago
      familySessionsDeleted: 1,
    })
    expect(await cleanupSessions(client, { apply: true })).toEqual({ ...dry, applied: true })

    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "successorTokenEnc" IS NOT NULL`)).toBe('0')
    expect(sql(DB, `SELECT string_agg("id", ',' ORDER BY "id") FROM "SessionFamily"`)).toBe([live.familyId, recentOut.familyId].sort().join(','))
    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "id" IN ('${live.sessionId}', '${l1.issued.sessionId}')`)).toBe('0')
    expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "id" = '${l2.issued.sessionId}'`)).toBe('1')
    // the live tail still refreshes; a deleted old token is simply unknown now
    expect(ok(await refreshSession(client, l3.issued.refreshToken, { clientType: 'web' })).replay).toBe(false)
    expect(await refreshSession(client, live.refreshToken, { clientType: 'web' })).toEqual({ ok: false, code: 'INVALID_TOKEN' })
    // second run: nothing left to delete
    const again = await cleanupSessions(client, { apply: false })
    expect(again.rotatedSessionsDeleted + again.familiesDeleted).toBe(0)
  })
})
