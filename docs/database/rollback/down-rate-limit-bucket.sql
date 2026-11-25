-- Reverse 20261125000000_rate_limit_bucket (counters of the Go API's rate
-- limiter). Run it FIRST, before down-password-reset.sql, when rolling back
-- further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-rate-limit-bucket.sql "$DATABASE_URL"
-- Only counters are lost (every limit starts a new window); no user content
-- is stored in this table. The Next.js API never reads it.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261125000000_rate_limit_bucket' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261125000000_rate_limit_bucket is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261125000000_rate_limit_bucket' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP TABLE "RateLimitBucket";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261125000000_rate_limit_bucket';
