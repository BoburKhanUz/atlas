-- Reverse migration 20261006000300_session_families so the Phase 2 build can
-- run again (rollback paths R-B / R-C in docs/database/cutover.md).
--
-- Run ONLY with every new-build instance stopped, as ONE transaction:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-session-families.sql "$DATABASE_URL"
-- Without --single-transaction the LOCK below fails and nothing is changed.
--
-- Loses: session families, encrypted successor tokens, device names, the
-- cutover marker. Keeps all user data. Mobile sessions are revoked (Phase 2
-- would accept their refresh tokens as cookies without the client binding).
\set ON_ERROR_STOP on

SET LOCAL lock_timeout = '30s';
LOCK TABLE "Session" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261006000300_session_families'
                    AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'session_families is not applied; nothing to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261006000300_session_families' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

-- 1. Carry family state down to the session rows (Phase 2 only reads those).
UPDATE "Session" s SET "revokedAt" = COALESCE(f."revokedAt", date_trunc('milliseconds', now() AT TIME ZONE 'UTC'))
  FROM "SessionFamily" f
 WHERE s."familyId" = f."id" AND s."revokedAt" IS NULL
   AND (f."revokedAt" IS NOT NULL OR f."clientType" = 'mobile');
UPDATE "Session" s SET "expiresAt" = LEAST(s."expiresAt", f."absoluteExpiresAt")
  FROM "SessionFamily" f WHERE s."familyId" = f."id";

-- 2. Remove the session-families schema.
ALTER TABLE "Session" DROP CONSTRAINT "Session_familyId_fkey";
DROP INDEX "Session_familyId_idx";
DROP INDEX "Session_replacedById_key";
ALTER TABLE "Session" DROP COLUMN "familyId", DROP COLUMN "rotatedAt", DROP COLUMN "rotatedAtSource",
                      DROP COLUMN "successorTokenEnc", DROP COLUMN "deviceName";
DROP TABLE "SessionFamily";
DROP TABLE "SystemMarker";
DROP FUNCTION atlas_now();
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261006000300_session_families';
