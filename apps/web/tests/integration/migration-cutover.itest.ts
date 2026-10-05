/**
 * CUTTS: legacyCutoverAt is strictly later than every legacy write that can
 * be in the migrated data — including a writer that was blocked behind the
 * migration's lock and committed after the migration transaction started —
 * and no legacy (Phase 2) write can commit after the cutover.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb, dropDb, enabled, migrationsDir, MIGRATION_NAMES, prisma, prismaSpawn, psqlSession, rmDir, rows, seedUsers, sql, waitFor,
} from './pg'

const M4 = MIGRATION_NAMES.indexOf('20261006000300_session_families')
const BASE = 'itest_cut_base'

// pg_locks and pg_stat_activity are cluster-wide, and databases cloned from
// one template share table OIDs: always restrict to the current database.
const THIS_DB = `l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`

const waitingLockOnSession = (db: string) =>
  sql(
    db,
    `SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE ${THIS_DB} AND c.relname = 'Session' AND NOT l.granted AND l.mode = 'AccessExclusiveLock'`,
  ) === '1'

const backendState = (db: string, app: string) =>
  sql(db, `SELECT coalesce(string_agg(state || ':' || coalesce(wait_event_type, '-'), ','), 'none') FROM pg_stat_activity WHERE datname = current_database() AND application_name = '${app}'`)

describe.skipIf(!enabled)('session_families migration — cutover timestamp', () => {
  const dirs: string[] = []
  let full = ''

  beforeAll(async () => {
    expect(sql('postgres', 'SHOW track_commit_timestamp')).toBe('on')
    createDb(BASE)
    const before = migrationsDir(M4)
    dirs.push(before)
    const r = await prisma(BASE, before)
    expect(r.code, r.output).toBe(0)
    seedUsers(BASE, 1)
    sql(
      BASE,
      `INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt")
       VALUES ('s1','u1','h1', now() + interval '30 days', now() AT TIME ZONE 'UTC' - interval '1 hour');
       CREATE TABLE itest_writes (tag text PRIMARY KEY, written_at timestamp(3) NOT NULL);`,
    )
    full = migrationsDir()
    dirs.push(full)
  })

  afterAll(() => {
    dirs.forEach(rmDir)
    if (!process.env.ATLAS_ITEST_KEEP) for (const db of [BASE, 'itest_cut_01', 'itest_cut_02', 'itest_cut_03', 'itest_cut_04']) dropDb(db)
  })

  it('CUTTS-01: a legacy rotation blocked by the lock and committed mid-migration is before the cutover', async () => {
    const db = 'itest_cut_01'
    createDb(db, BASE)
    // Phase 2 rotation, holding its row locks: insert successor, retire s1.
    const writer = psqlSession(db, 'itest_writer')
    writer.send(`BEGIN;
      INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt") VALUES ('s2','u1','h2', now() + interval '30 days', clock_timestamp() AT TIME ZONE 'UTC');
      SELECT 'ready';`)
    await waitFor(() => writer.output().includes('ready'), 'writer to start')

    const deploy = prismaSpawn(db, full)
    await waitFor(() => waitingLockOnSession(db), 'migration to block on LOCK TABLE "Session"')
    // (pg_stat_activity.query is truncated, so find the waiter through pg_locks)
    const blockedSince = sql(
      db,
      `SELECT a.xact_start FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid JOIN pg_class c ON c.oid = l.relation
        WHERE ${THIS_DB} AND c.relname = 'Session' AND NOT l.granted AND l.mode = 'AccessExclusiveLock'`,
    )
    expect(blockedSince).not.toBe('')

    // still inside the writer: last legacy timestamp, then COMMIT
    writer.send(`UPDATE "Session" SET "revokedAt" = clock_timestamp() AT TIME ZONE 'UTC', "replacedById" = 's2' WHERE "id" = 's1';
      INSERT INTO itest_writes VALUES ('w1', clock_timestamp() AT TIME ZONE 'UTC');
      COMMIT;`)
    writer.end()
    expect(await writer.done).toBe(0)

    const r = await deploy.done
    expect(r.code, r.output).toBe(0)

    const [t] = rows<{ cut: string; started: string; commit: string; app_ts: string; revoked: string; ok_cut: boolean; ok_started: boolean; ok_app: boolean }>(
      db,
      `SELECT c."value"::text AS cut, m."value"::text AS started,
              (pg_xact_commit_timestamp(w.xmin) AT TIME ZONE 'UTC')::text AS commit,
              w.written_at::text AS app_ts, s."revokedAt"::text AS revoked,
              c."value" > (pg_xact_commit_timestamp(w.xmin) AT TIME ZONE 'UTC') AS ok_cut,
              m."value" < (pg_xact_commit_timestamp(w.xmin) AT TIME ZONE 'UTC') AS ok_started,
              c."value" > s."revokedAt" AND c."value" > w.written_at AS ok_app
         FROM "SystemMarker" c, "SystemMarker" m, itest_writes w, "Session" s
        WHERE c."key" = 'legacyCutoverAt' AND m."key" = 'migrationStartedAt' AND w.tag = 'w1' AND s."id" = 's1'`,
    )
    console.log('CUTTS-01', t)
    // the writer committed after the migration transaction began (so now() would be too early)…
    expect(t.ok_started).toBe(true)
    // …and the cutover is still strictly after its commit and its own timestamps
    expect(t.ok_cut).toBe(true)
    expect(t.ok_app).toBe(true)
    // the rotation it committed is part of the migrated data (one healthy family)
    expect(sql(db, `SELECT count(DISTINCT "familyId") || ':' || count(*) FILTER (WHERE "rotatedAtSource" = 'legacy') FROM "Session"`)).toBe('1:1')
    expect(sql(db, `SELECT "revokeReason" IS NULL AND "revokedAt" IS NULL FROM "SessionFamily"`)).toBe('t')
  })

  it('CUTTS-04: a legacy rotation queued behind the migration cannot commit after the cutover', async () => {
    const db = 'itest_cut_04'
    createDb(db, BASE)
    // a reader keeps the migration waiting so the legacy writer queues behind it
    const reader = psqlSession(db, 'itest_reader')
    reader.send(`BEGIN; SELECT count(*) FROM "Session"; SELECT 'ready';`)
    await waitFor(() => reader.output().includes('ready'), 'reader to start')
    const deploy = prismaSpawn(db, full)
    await waitFor(() => waitingLockOnSession(db), 'migration to queue for the lock')

    const writer = psqlSession(db, 'itest_writer')
    writer.send(`BEGIN;
      INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt") VALUES ('s2','u1','h2', now() + interval '30 days', clock_timestamp() AT TIME ZONE 'UTC');
      UPDATE "Session" SET "revokedAt" = clock_timestamp() AT TIME ZONE 'UTC', "replacedById" = 's2' WHERE "id" = 's1';
      COMMIT;`)
    writer.end()
    await waitFor(() => backendState(db, 'itest_writer').includes('Lock'), 'legacy writer to queue behind the migration')

    reader.send('COMMIT;')
    reader.end()
    expect(await reader.done).toBe(0)
    const r = await deploy.done
    expect(r.code, r.output).toBe(0)

    expect(await writer.done).not.toBe(0)
    expect(writer.output()).toMatch(/null value in column "familyId"/)
    // nothing from the legacy writer landed
    expect(sql(db, `SELECT string_agg("id" || ':' || ("revokedAt" IS NULL)::text || ':' || coalesce("replacedById", '-'), ',' ORDER BY "id") FROM "Session"`)).toBe('s1:true:-')
  })

  it('CUTTS-02: no contention — cutover = ceil_ms(clock read after the lock), bracketed by independent clock reads', async () => {
    const db = 'itest_cut_02'
    createDb(db, BASE)
    // test copy only: probes record clock_timestamp() right before the LOCK and as the last statement
    const probed = migrationsDir(undefined, (name, text) => {
      if (name !== '20261006000300_session_families') return text
      const lock = 'LOCK TABLE "Session" IN ACCESS EXCLUSIVE MODE;'
      return (
        text.replace(lock, `CREATE TABLE itest_probe AS SELECT 'before_lock'::text AS tag, clock_timestamp() AT TIME ZONE 'UTC' AS t;\n${lock}`) +
        `\nINSERT INTO itest_probe SELECT 'end', clock_timestamp() AT TIME ZONE 'UTC';\n`
      )
    })
    dirs.push(probed)
    const r = await prisma(db, probed)
    expect(r.code, r.output).toBe(0)
    const [t] = rows<Record<string, boolean | string>>(
      db,
      `SELECT c."value"::text AS cut, m."value"::text AS started, b.t::text AS before_lock, e.t::text AS at_end,
              c."value" >= m."value" AS ge_started,
              c."value" = date_trunc('milliseconds', c."value") AS ms_precision,
              c."value" > b.t AS after_lock_read,
              c."value" <= date_trunc('milliseconds', e.t) + interval '1 millisecond' AS not_after_end_ceiling,
              m."value" = date_trunc('milliseconds', b.t) OR m."value" < b.t AS started_is_xact_start
         FROM "SystemMarker" c, "SystemMarker" m, itest_probe b, itest_probe e
        WHERE c."key" = 'legacyCutoverAt' AND m."key" = 'migrationStartedAt' AND b.tag = 'before_lock' AND e.tag = 'end'`,
    )
    console.log('CUTTS-02', t)
    expect(t).toMatchObject({ ge_started: true, ms_precision: true, after_lock_read: true, not_after_end_ceiling: true, started_is_xact_start: true })
  })

  it('CUTTS-03: the cutover is UTC wall-clock time whatever the server/session TimeZone', async () => {
    const db = 'itest_cut_03'
    createDb(db, BASE)
    sql('postgres', `ALTER DATABASE ${db} SET TimeZone = 'Pacific/Kiritimati'`) // UTC+14
    const r = await prisma(db, full)
    expect(r.code, r.output).toBe(0)
    const skew = Number(sql(db, `SELECT abs(extract(epoch FROM (SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt') - (clock_timestamp() AT TIME ZONE 'UTC')))`))
    expect(skew).toBeLessThan(60)
    // millisecond precision, strictly rounded up past clock_timestamp()
    expect(sql(db, `SELECT "value" = date_trunc('milliseconds', "value") FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)).toBe('t')
  })
})
