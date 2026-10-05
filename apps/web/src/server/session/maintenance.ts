/**
 * Session maintenance used by scripts/session-cleanup.ts (manual, dry run by
 * default). Output contains user and session ids only — never tokens, token
 * hashes, ciphertexts or e-mail addresses.
 *
 *  - preflightFamilies: READ-ONLY report, run against the Phase 2 database
 *    before the cutover. Predicts what migration 20261006000300_session_families
 *    will do (same component rules): healthy chains, fully revoked chains,
 *    anomalies (revoked at the cutover), duplicate links (the migration
 *    would fail), and how many live chains get the legacy transition limit.
 *  - cleanupSessions: after the cutover. Clears successor ciphertexts that can
 *    no longer be replayed (rotated > 60 s ago), deletes rotated sessions and
 *    whole families revoked or expired more than 30 days ago.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

export type AnomalyReason = 'cycle' | 'dangling_link' | 'user_mismatch' | 'time_inversion' | 'live_non_tail'

export interface PreflightReport {
  sessions: number
  duplicateLinks: { replacedById: string; predecessorIds: string[] }[]
  components: number
  planned: { healthyLive: number; migratedRevoked: number; anomaly: number }
  /**
   * Healthy live chains by the absolute limit the migration will give them if
   * the cutover happens now (see LEGACY_* below): `fromChainStart` keep
   * start + 90 days, `transition` get cutover + 30 days, and
   * `transitionEndsAt` is that date for a cutover now.
   */
  legacyLifetime: { fromChainStart: number; transition: number; transitionEndsAt: string }
  anomalies: { key: string; reasons: AnomalyReason[]; userId: string; sessionIds: string[]; liveSessionIds: string[] }[]
}

interface ComponentRow {
  key: string
  created_at: Date
  kind: 'chain' | 'cycle'
  user_id: string
  session_ids: string[]
  live_ids: string[] | null
  user_mismatch: boolean
  time_inversion: boolean
  live_non_tail: boolean
  dangling: boolean
}

/** Mirrors the legacy-family limit in migration 20261006000300_session_families. */
export const LEGACY_ABSOLUTE_DAYS = 90
export const LEGACY_TRANSITION_DAYS = 30

/** LEAST(cutover + 90 d, GREATEST(chainStart + 90 d, cutover + 30 d)) */
export function legacyAbsoluteExpiresAt(chainStart: Date, cutover: Date): Date {
  const day = 24 * 3600 * 1000
  const fromStart = chainStart.getTime() + LEGACY_ABSOLUTE_DAYS * day
  const transition = cutover.getTime() + LEGACY_TRANSITION_DAYS * day
  return new Date(Math.min(cutover.getTime() + LEGACY_ABSOLUTE_DAYS * day, Math.max(fromStart, transition)))
}

/** Exit status for the CLI: 0 clean, 2 anomalies, 3 the migration would fail (duplicate links). */
export function preflightExitCode(r: PreflightReport): number {
  if (r.duplicateLinks.length) return 3
  return r.anomalies.length ? 2 : 0
}

export async function preflightFamilies(client: PrismaClient): Promise<PreflightReport> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Session"`
      const duplicateLinks = await tx.$queryRaw<{ replacedById: string; predecessorIds: string[] }[]>`
        SELECT "replacedById", array_agg("id" ORDER BY "id") AS "predecessorIds"
          FROM "Session" WHERE "replacedById" IS NOT NULL
         GROUP BY "replacedById" HAVING count(*) > 1 ORDER BY "replacedById"`
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS now`
      const transitionEndsAt = legacyAbsoluteExpiresAt(new Date(0), now).toISOString()
      const noLegacy = { fromChainStart: 0, transition: 0, transitionEndsAt }
      const base = { sessions: Number(n), duplicateLinks }
      // With duplicate links the graph is not a set of simple paths: the
      // migration fails before the backfill, and walking it here could loop.
      if (duplicateLinks.length)
        return { ...base, components: 0, planned: { healthyLive: 0, migratedRevoked: 0, anomaly: 0 }, legacyLifetime: noLegacy, anomalies: [] }

      const comps = await tx.$queryRaw<ComponentRow[]>`
        WITH RECURSIVE
        walk(root_id, id) AS (
          SELECT s."id", s."id" FROM "Session" s
           WHERE NOT EXISTS (SELECT 1 FROM "Session" p WHERE p."replacedById" = s."id")
          UNION ALL
          SELECT w.root_id, n."id" FROM walk w
            JOIN "Session" c ON c."id" = w.id
            JOIN "Session" n ON n."id" = c."replacedById"
        ),
        cyc(start_id, id, path) AS (
          SELECT s."id", s."id", ARRAY[s."id"] FROM "Session" s
           WHERE NOT EXISTS (SELECT 1 FROM walk k WHERE k.id = s."id")
          UNION ALL
          SELECT c.start_id, n."id", c.path || n."id" FROM cyc c
            JOIN "Session" cur ON cur."id" = c.id
            JOIN "Session" n ON n."id" = cur."replacedById"
           WHERE NOT n."id" = ANY (c.path)
        ),
        assign(session_id, key, kind, root_id) AS (
          SELECT id, 'root:' || root_id, 'chain', root_id FROM walk
          UNION ALL
          SELECT start_id, 'cycle:' || min(id), 'cycle', NULL FROM cyc GROUP BY start_id
        )
        SELECT a.key, min(a.kind) AS kind, min(s."createdAt") AS created_at,
               coalesce(min(r."userId"), (array_agg(s."userId" ORDER BY s."createdAt", s."id"))[1]) AS user_id,
               array_agg(s."id" ORDER BY s."createdAt", s."id") AS session_ids,
               array_agg(s."id" ORDER BY s."id") FILTER (WHERE s."revokedAt" IS NULL) AS live_ids,
               bool_or(r."id" IS NOT NULL AND s."userId" <> r."userId") AS user_mismatch,
               bool_or(n."id" IS NOT NULL AND n."createdAt" < s."createdAt") AS time_inversion,
               bool_or(s."replacedById" IS NOT NULL AND s."revokedAt" IS NULL) AS live_non_tail,
               bool_or(s."replacedById" IS NOT NULL AND n."id" IS NULL) AS dangling
          FROM assign a
          JOIN "Session" s ON s."id" = a.session_id
          LEFT JOIN "Session" r ON r."id" = a.root_id
          LEFT JOIN "Session" n ON n."id" = s."replacedById"
         GROUP BY a.key
         ORDER BY a.key`

      const planned = { healthyLive: 0, migratedRevoked: 0, anomaly: 0 }
      const legacyLifetime = { ...noLegacy }
      const anomalies: PreflightReport['anomalies'] = []
      for (const c of comps) {
        const reasons: AnomalyReason[] = []
        if (c.kind === 'cycle') reasons.push('cycle')
        if (c.dangling) reasons.push('dangling_link')
        if (c.user_mismatch) reasons.push('user_mismatch')
        if (c.time_inversion) reasons.push('time_inversion')
        if (c.live_non_tail) reasons.push('live_non_tail')
        if (reasons.length) {
          planned.anomaly++
          anomalies.push({ key: c.key, reasons, userId: c.user_id, sessionIds: c.session_ids, liveSessionIds: c.live_ids ?? [] })
        } else if (c.live_ids?.length) {
          planned.healthyLive++
          if (legacyAbsoluteExpiresAt(c.created_at, now).toISOString() === transitionEndsAt) legacyLifetime.transition++
          else legacyLifetime.fromChainStart++
        }        else planned.migratedRevoked++
      }
      return { ...base, components: comps.length, planned, legacyLifetime, anomalies }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 600_000, maxWait: 10_000 },
  )
}

export interface CleanupReport {
  applied: boolean
  successorCiphertextsCleared: number
  rotatedSessionsDeleted: number
  familiesDeleted: number
  familySessionsDeleted: number
}

const RETENTION = Prisma.sql`interval '30 days'`

export async function cleanupSessions(client: PrismaClient, opts: { apply: boolean }): Promise<CleanupReport> {
  return client.$transaction(
    async (tx) => {
      if (!opts.apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`)
      // a ciphertext only serves a replay within 60 s of its rotation
      const staleCipher = Prisma.sql`"successorTokenEnc" IS NOT NULL AND "rotatedAt" < atlas_now() - interval '60 seconds'`
      // dead families: revoked, or past their absolute limit, for > 30 days
      const deadFamily = Prisma.sql`("revokedAt" < atlas_now() - ${RETENTION} OR "absoluteExpiresAt" < atlas_now() - ${RETENTION})`
      // rotated rows of other families, rotated > 30 days ago (never a live tail)
      const oldRotated = Prisma.sql`"replacedById" IS NOT NULL AND "revokedAt" < atlas_now() - ${RETENTION}
        AND "familyId" NOT IN (SELECT "id" FROM "SessionFamily" WHERE ${deadFamily})`

      const count = async (q: Prisma.Sql) => Number((await tx.$queryRaw<{ n: bigint }[]>(q))[0].n)
      const report: CleanupReport = {
        applied: opts.apply,
        successorCiphertextsCleared: await count(Prisma.sql`SELECT count(*) AS n FROM "Session" WHERE ${staleCipher}`),
        rotatedSessionsDeleted: await count(Prisma.sql`SELECT count(*) AS n FROM "Session" WHERE ${oldRotated}`),
        familiesDeleted: await count(Prisma.sql`SELECT count(*) AS n FROM "SessionFamily" WHERE ${deadFamily}`),
        familySessionsDeleted: await count(
          Prisma.sql`SELECT count(*) AS n FROM "Session" WHERE "familyId" IN (SELECT "id" FROM "SessionFamily" WHERE ${deadFamily})`,
        ),
      }
      if (opts.apply) {
        await tx.$executeRaw(Prisma.sql`UPDATE "Session" SET "successorTokenEnc" = NULL WHERE ${staleCipher}`)
        await tx.$executeRaw(Prisma.sql`DELETE FROM "Session" WHERE ${oldRotated}`)
        await tx.$executeRaw(Prisma.sql`DELETE FROM "SessionFamily" WHERE ${deadFamily}`) // sessions cascade
      }
      return report
    },
    { timeout: 600_000, maxWait: 10_000 },
  )
}
