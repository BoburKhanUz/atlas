-- Reverse 20261009000000_color_profile_v2 (colour profile version and
-- confidence columns, one profile per user). Run it FIRST, before
-- down-wardrobe-analysis-metadata.sql, when rolling back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-color-profile-v2.sql "$DATABASE_URL"
-- Current profiles are kept (season, undertone, palettes). Lost: the version
-- and confidence columns. Not restorable: the superseded profile rows and the
-- raw colour averages the migration deleted (they were never read).
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261009000000_color_profile_v2' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261009000000_color_profile_v2 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261009000000_color_profile_v2' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP INDEX "ColorProfile_userId_key";
CREATE INDEX "ColorProfile_userId_idx" ON "ColorProfile"("userId");
ALTER TABLE "ColorProfile"
  DROP COLUMN "analysisVersion",
  DROP COLUMN "confidence",
  DROP COLUMN "secondaryConfidence",
  DROP COLUMN "secondarySeason",
  DROP COLUMN "undertoneConfidence";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009000000_color_profile_v2';
