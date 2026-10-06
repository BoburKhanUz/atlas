-- Reverse 20261007000000_ai_usage (AI quota counters). Run it FIRST, before
-- down-session-families.sql, when rolling back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-ai-usage.sql "$DATABASE_URL"
-- Only usage counters are lost (no user content is stored in this table).
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261007000000_ai_usage' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261007000000_ai_usage is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261007000000_ai_usage' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP TABLE "AiUsage";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261007000000_ai_usage';
