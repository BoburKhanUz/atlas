-- Optional: reverse 20261006000200_idempotency_keys (not needed for a Phase 2
-- rollback — Phase 2 ignores the table). Run after down-session-families.sql:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-idempotency-keys.sql "$DATABASE_URL"
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261006000200_idempotency_keys' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP TABLE "IdempotencyKey";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261006000200_idempotency_keys';
