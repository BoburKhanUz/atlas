-- Reverse 20261008000000_wardrobe_analysis_metadata (analysis provider/model
-- metadata). Run it FIRST, before down-ai-usage.sql, when rolling back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-wardrobe-analysis-metadata.sql "$DATABASE_URL"
-- Item attributes are kept; only the record of which provider/model analysed
-- each photo, and the raw model confidences, are lost.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261008000000_wardrobe_analysis_metadata' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261008000000_wardrobe_analysis_metadata is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261008000000_wardrobe_analysis_metadata' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

ALTER TABLE "WardrobeItem"
  DROP COLUMN "analysisModel",
  DROP COLUMN "analysisProvider",
  DROP COLUMN "analysisRawConfidences",
  DROP COLUMN "analysisVersion",
  DROP COLUMN "analyzedAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008000000_wardrobe_analysis_metadata';
