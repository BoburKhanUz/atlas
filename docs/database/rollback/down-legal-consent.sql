-- Reverse 20261017000000_legal_consent (legal consent records). Run it after
-- down-password-reset.sql and before down-color-profile-v2.sql when rolling
-- back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-legal-consent.sql "$DATABASE_URL"
-- The consent records are lost: export them first if they must be kept as
-- evidence (no other user content is stored in this table).
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261017000000_legal_consent' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261017000000_legal_consent is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261017000000_legal_consent' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP TABLE "LegalConsent";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261017000000_legal_consent';
