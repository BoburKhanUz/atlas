/**
 * MIGATOM: an error anywhere in a new migration (the real files with an
 * injected failure) leaves schema and data exactly as before, leaves one
 * failed _prisma_migrations row, and the documented recovery
 * (`migrate resolve --rolled-back`, then deploy) reaches a drift-free schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb, dbUrl, dropDb, enabled, migrationRows, migrationsDir, MIGRATION_NAMES, prisma, rmDir, seedUsers, snapshot, sql,
} from './pg'

const M2 = '20261006000100_media_variants'
const M3 = '20261006000200_idempotency_keys'
const M4 = '20261006000300_session_families'
const idx = (name: string) => MIGRATION_NAMES.indexOf(name)
const BASE = 'itest_atom_base'

const FAIL = `SELECT 1/0; -- injected failure`

function before(marker: string) {
  return (text: string) => {
    const i = text.indexOf(marker)
    if (i < 0) throw new Error(`marker not found: ${marker}`)
    return text.slice(0, i) + FAIL + '\n' + text.slice(i)
  }
}

interface Case {
  id: string
  migration: string
  inject: (text: string) => string
  error: RegExp
}

const CASES: Case[] = [
  { id: 'M2-late', migration: M2, inject: (t) => t + '\n' + FAIL + '\n', error: /division by zero/ },
  { id: 'M3-mid', migration: M3, inject: before('-- CreateIndex'), error: /division by zero/ },
  { id: 'M3-late', migration: M3, inject: (t) => t + '\n' + FAIL + '\n', error: /division by zero/ },
  { id: 'M4-after-marker', migration: M4, inject: before('-- CreateTable\nCREATE TABLE "SessionFamily"'), error: /division by zero/ },
  { id: 'M4-after-backfill', migration: M4, inject: before('-- ── Constraints'), error: /division by zero/ },
  { id: 'M4-late', migration: M4, inject: (t) => t + '\n' + FAIL + '\n', error: /division by zero/ },
  {
    id: 'M4-guard-missing-assignment',
    migration: M4,
    inject: (t) => before('DO $$')(t).replace(FAIL, `DELETE FROM "_atlas_assign" WHERE session_id = (SELECT min(session_id) FROM "_atlas_assign");`),
    error: /session_families backfill: \d+ sessions but \d+ assignments/,
  },
  {
    id: 'M4-guard-double-assignment',
    migration: M4,
    inject: (t) => before('DO $$')(t).replace(FAIL, `INSERT INTO "_atlas_assign" SELECT session_id, 'x', false FROM "_atlas_assign" LIMIT 1;`),
    error: /duplicate key value violates unique constraint "_atlas_assign_pkey"/,
  },
  {
    id: 'M4-guard-unassigned-session',
    migration: M4,
    inject: (t) => before('-- Any session left without a family')(t).replace(FAIL, `UPDATE "Session" SET "familyId" = NULL WHERE "id" = (SELECT min("id") FROM "Session");`),
    error: /column "familyId" of relation "Session" contains null values/,
  },
]

describe.skipIf(!enabled)('new migrations are atomic under injected failures', () => {
  const dirs: string[] = []
  const used: string[] = [BASE]
  let full = ''

  beforeAll(async () => {
    createDb(BASE)
    const phase2 = migrationsDir(idx(M2))
    dirs.push(phase2)
    const r = await prisma(BASE, phase2)
    expect(r.code, r.output).toBe(0)
    seedUsers(BASE, 2)
    sql(
      BASE,
      `INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt") VALUES ('w1','u1','top', now()), ('w2','u2','bottom', now());
       INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","thumbnailKey","isPrimary","width","height")
         VALUES ('i1','w1','u1/a.jpg','u1/a_t.jpg',true,800,600), ('i2','w2','u2/b.jpg',NULL,true,NULL,NULL);
       INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById") VALUES
         ('s1','u1','h1', now() + interval '30 days', now() - interval '2 hours', now() - interval '1 hour', 's2'),
         ('s2','u1','h2', now() + interval '30 days', now() - interval '1 hour', NULL, NULL),
         ('s3','u2','h3', now() + interval '30 days', now() - interval '3 hours', now() - interval '2 hours', NULL),
         ('s4','u2','h4', now() + interval '30 days', now() - interval '1 hour', NULL, 's4');`,
    )
    full = migrationsDir()
    dirs.push(full)
  })

  afterAll(() => {
    dirs.forEach(rmDir)
    if (!process.env.ATLAS_ITEST_KEEP) used.forEach(dropDb)
  })

  for (const c of CASES) {
    it(`MIGATOM ${c.id}`, async () => {
      const db = `itest_atom_${c.id.toLowerCase().replace(/-/g, '_')}`
      used.push(db)
      createDb(db, BASE)
      // bring the database to the state just before the migration under test
      const pre = migrationsDir(idx(c.migration))
      dirs.push(pre)
      const r0 = await prisma(db, pre)
      expect(r0.code, r0.output).toBe(0)

      const snapBefore = snapshot(db)
      const rowsBefore = migrationRows(db)

      const injected = migrationsDir(undefined, (name, text) => (name === c.migration ? c.inject(text) : text))
      dirs.push(injected)
      const r1 = await prisma(db, injected)
      expect(r1.code).not.toBe(0)
      expect(r1.output).toMatch(/P3018/)
      expect(r1.output).toMatch(c.error)

      // nothing changed
      const snapAfter = snapshot(db)
      expect(snapAfter.schema).toBe(snapBefore.schema)
      expect(snapAfter.data).toBe(snapBefore.data)
      expect(sql(db, `SELECT count(*) FROM pg_proc WHERE proname = 'atlas_now'`)).toBe('0')
      // bookkeeping: earlier rows untouched, one failed row, later migrations not attempted
      const rowsAfter = migrationRows(db)
      expect(rowsAfter.slice(0, rowsBefore.length)).toEqual(rowsBefore)
      expect(rowsAfter.slice(rowsBefore.length)).toEqual([
        { migration_name: c.migration, finished: false, rolled_back: false, steps: 0, has_logs: true },
      ])

      // a plain redeploy is refused until the failure is resolved
      const r2 = await prisma(db, full)
      expect(r2.code).not.toBe(0)
      expect(r2.output).toMatch(/P3009/)

      // documented recovery
      const r3 = await prisma(db, full, ['migrate', 'resolve', '--rolled-back', c.migration])
      expect(r3.code, r3.output).toBe(0)
      const r4 = await prisma(db, full)
      expect(r4.code, r4.output).toBe(0)
      const r5 = await prisma(db, full, ['migrate', 'diff', '--from-url', dbUrl(db), '--to-schema-datamodel', `${full}/schema.prisma`, '--exit-code'])
      expect(r5.code, r5.output).toBe(0)
      expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')
      expect(sql(db, `SELECT string_agg(coalesce("revokeReason", 'live'), ',' ORDER BY coalesce("revokeReason", 'live')) FROM "SessionFamily"`)).toBe('anomaly,live,migrated')
      expect(sql(db, `SELECT string_agg("id" || ':' || "storageKey", ',' ORDER BY "id") FROM "WardrobeImage"`)).toBe('i1:u1/a.jpg,i2:u2/b.jpg')
    })
  }
})
