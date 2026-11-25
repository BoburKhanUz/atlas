-- Reverse 20261017010000_password_reset (one-time password reset links). Run
-- it after down-rate-limit-bucket.sql and before down-legal-consent.sql when
-- rolling back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-password-reset.sql "$DATABASE_URL"
-- Pending reset links stop working (users can request a new one after a
-- roll forward); no user content is stored in this table.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261017010000_password_reset' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261017010000_password_reset is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261017010000_password_reset' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP TABLE "PasswordResetToken";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261017010000_password_reset';
