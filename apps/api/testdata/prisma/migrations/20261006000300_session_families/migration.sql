-- Session families + stop-the-world cutover (docs/database/cutover.md).
--
-- PRECONDITION: every Phase 2 (old-build) instance is stopped.
--
-- Runs as ONE transaction: Prisma 6.19.2 sends this file as a single
-- simple-protocol query, which PostgreSQL executes as one implicit transaction
-- (verified in S2 by server logs and failure injection). NEVER add a statement
-- that cannot run inside a transaction block (e.g. CREATE INDEX CONCURRENTLY).
--
-- Every existing session ends up in exactly one SessionFamily, or the whole
-- migration fails and nothing is changed:
--   * replacedById becomes UNIQUE first, so each session has <= 1 predecessor
--     and <= 1 successor; duplicate links abort the migration;
--   * each component is then either a chain (one root) or a cycle (no root);
--   * chains are walked from their root (cannot loop: a revisit would need a
--     node with two predecessors); rows no root reaches are exactly cycle rows;
--   * a temp table keyed by session id rejects double assignment, an explicit
--     count check rejects missing rows, and SET NOT NULL rejects leftovers.
-- Inconsistent components are not guessed: they get a family revoked at the
-- cutover with revokeReason = 'anomaly' (those users sign in again).

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- Blocks every concurrent Session writer until COMMIT. A writer that commits
-- while we wait is part of the snapshot below; one that starts later waits and
-- then fails on familyId NOT NULL.
LOCK TABLE "Session" IN ACCESS EXCLUSIVE MODE;

-- CreateTable
CREATE TABLE "SystemMarker" (
    "key" TEXT NOT NULL,
    "value" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemMarker_pkey" PRIMARY KEY ("key")
);

-- legacyCutoverAt is read with clock_timestamp() AFTER the lock is granted
-- (now() is the transaction start, which can precede a blocked writer's
-- commit), in UTC (columns are timestamp without time zone), rounded UP to
-- the next millisecond so it is strictly later than any committed legacy write.
-- migrationStartedAt is for observability only; never used for security.
INSERT INTO "SystemMarker" ("key", "value") VALUES
  ('migrationStartedAt', date_trunc('milliseconds', now() AT TIME ZONE 'UTC')),
  ('legacyCutoverAt', date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') + interval '1 millisecond');

-- CreateTable
CREATE TABLE "SessionFamily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientType" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "SessionFamily_pkey" PRIMARY KEY ("id")
);

-- AlterTable (familyId becomes NOT NULL after the backfill below)
ALTER TABLE "Session" ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotatedAtSource" TEXT,
ADD COLUMN     "successorTokenEnc" TEXT;

-- CreateIndex (duplicate links fail here and abort everything)
CREATE UNIQUE INDEX "Session_replacedById_key" ON "Session"("replacedById");

-- ── Backfill ────────────────────────────────────────────────────────────────

-- Chains: walk from every root (a session no other session points to).
CREATE TEMP TABLE "_atlas_comp" ON COMMIT DROP AS
WITH RECURSIVE walk(root_id, id) AS (
  SELECT s."id", s."id" FROM "Session" s
   WHERE NOT EXISTS (SELECT 1 FROM "Session" p WHERE p."replacedById" = s."id")
  UNION ALL
  SELECT w.root_id, n."id"
    FROM walk w
    JOIN "Session" c ON c."id" = w.id
    JOIN "Session" n ON n."id" = c."replacedById"
)
SELECT root_id, id FROM walk;

-- Cycles: rows no root reaches. From each, walk until returning to it; the
-- cycle's representative is its smallest id (path guard ensures termination).
CREATE TEMP TABLE "_atlas_cyc" ON COMMIT DROP AS
WITH RECURSIVE cyc(start_id, id, path) AS (
  SELECT s."id", s."id", ARRAY[s."id"] FROM "Session" s
   WHERE NOT EXISTS (SELECT 1 FROM "_atlas_comp" k WHERE k.id = s."id")
  UNION ALL
  SELECT c.start_id, n."id", c.path || n."id"
    FROM cyc c
    JOIN "Session" cur ON cur."id" = c.id
    JOIN "Session" n ON n."id" = cur."replacedById"
   WHERE NOT n."id" = ANY (c.path)
)
SELECT start_id AS id, min(id) AS rep FROM cyc GROUP BY start_id;

-- Inconsistent chains (all members of the chain are affected).
CREATE TEMP TABLE "_atlas_bad" ON COMMIT DROP AS
SELECT DISTINCT c.root_id FROM "_atlas_comp" c
  JOIN "Session" s ON s."id" = c.id
  JOIN "Session" r ON r."id" = c.root_id
 WHERE s."userId" <> r."userId"                                  -- user mismatch
UNION
SELECT c.root_id FROM "_atlas_comp" c
  JOIN "Session" s ON s."id" = c.id
  JOIN "Session" n ON n."id" = s."replacedById"
 WHERE n."createdAt" < s."createdAt"                             -- time goes backwards
UNION
SELECT c.root_id FROM "_atlas_comp" c
  JOIN "Session" s ON s."id" = c.id
 WHERE s."replacedById" IS NOT NULL AND s."revokedAt" IS NULL     -- live session that is not the tail
UNION
SELECT c.root_id FROM "_atlas_comp" c
  JOIN "Session" s ON s."id" = c.id
 WHERE s."replacedById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "Session" n WHERE n."id" = s."replacedById");  -- dangling link

-- Exactly one assignment per session (PRIMARY KEY rejects duplicates).
CREATE TEMP TABLE "_atlas_assign" (
  session_id TEXT PRIMARY KEY,
  family_key TEXT NOT NULL,
  anomaly    BOOLEAN NOT NULL
) ON COMMIT DROP;
INSERT INTO "_atlas_assign" (session_id, family_key, anomaly)
SELECT c.id, 'root:' || c.root_id, (b.root_id IS NOT NULL)
  FROM "_atlas_comp" c LEFT JOIN "_atlas_bad" b ON b.root_id = c.root_id;
INSERT INTO "_atlas_assign" (session_id, family_key, anomaly)
SELECT y.id, 'cycle:' || y.rep, TRUE FROM "_atlas_cyc" y;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Session") <> (SELECT count(*) FROM "_atlas_assign") THEN
    RAISE EXCEPTION 'session_families backfill: % sessions but % assignments',
      (SELECT count(*) FROM "Session"), (SELECT count(*) FROM "_atlas_assign");
  END IF;
END $$;

-- One family per chain or cycle.
CREATE TEMP TABLE "_atlas_fam" ON COMMIT DROP AS
SELECT a.family_key,
       gen_random_uuid()::text                                   AS family_id,
       bool_or(a.anomaly)                                        AS anomaly,
       min(s."createdAt")                                        AS created_at,
       bool_or(s."revokedAt" IS NULL)                            AS has_live,
       max(s."revokedAt")                                        AS last_revoked,
       (array_agg(s."userId" ORDER BY s."createdAt", s."id"))[1] AS user_id
  FROM "_atlas_assign" a JOIN "Session" s ON s."id" = a.session_id
 GROUP BY a.family_key;

-- Absolute limit of a migrated (legacy) family: a bounded transition anchored
-- at the cutover, so Phase 2 users whose chain began long ago are not all
-- signed out at once (docs/database/cutover.md, "Legacy session lifetime"):
--   LEAST(cutover + 90 days, GREATEST(chain start + 90 days, cutover + 30 days))
-- * chain started <= 60 days before the cutover: start + 90 days (as for a new login);
-- * older chains: cutover + 30 days (the transition window);
-- * never later than cutover + 90 days (also bounds a createdAt in the future).
-- New families (login after the cutover) are not affected: createdAt + 90 days.
INSERT INTO "SessionFamily" ("id", "userId", "clientType", "createdAt", "absoluteExpiresAt", "revokedAt", "revokeReason")
SELECT f.family_id, f.user_id, 'web', f.created_at,
       LEAST(m."value" + interval '90 days',
             GREATEST(f.created_at + interval '90 days', m."value" + interval '30 days')),
       CASE WHEN f.anomaly THEN (SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt')
            WHEN NOT f.has_live THEN f.last_revoked END,
       CASE WHEN f.anomaly THEN 'anomaly'
            WHEN NOT f.has_live THEN 'migrated' END
  FROM "_atlas_fam" f
 CROSS JOIN (SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt') m;

UPDATE "Session" s
   SET "familyId" = f.family_id
  FROM "_atlas_assign" a JOIN "_atlas_fam" f ON f.family_key = a.family_key
 WHERE s."id" = a.session_id;

-- Anomalous families: revoke their live sessions too (session rows alone must
-- always be enough to enforce revocation).
UPDATE "Session" s
   SET "revokedAt" = (SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt')
  FROM "SessionFamily" f
 WHERE s."familyId" = f."id" AND f."revokeReason" = 'anomaly' AND s."revokedAt" IS NULL;

-- Rotated legacy rows: informational copy of the old build's revokedAt.
-- rotatedAtSource = 'legacy' means it is NEVER used for security decisions
-- (the refresh logic uses legacyCutoverAt instead).
UPDATE "Session" SET "rotatedAt" = "revokedAt", "rotatedAtSource" = 'legacy'
 WHERE "replacedById" IS NOT NULL;

-- ── Constraints ─────────────────────────────────────────────────────────────

-- CreateIndex
CREATE INDEX "SessionFamily_userId_idx" ON "SessionFamily"("userId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");

-- AddForeignKey
ALTER TABLE "SessionFamily" ADD CONSTRAINT "SessionFamily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "SessionFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Any session left without a family aborts the whole migration here.
ALTER TABLE "Session" ALTER COLUMN "familyId" SET NOT NULL;

-- Database clock for the refresh protocol (UTC, millisecond precision).
CREATE FUNCTION atlas_now() RETURNS timestamp(3) LANGUAGE sql STABLE
  AS $$ SELECT date_trunc('milliseconds', now() AT TIME ZONE 'UTC')::timestamp(3) $$;
