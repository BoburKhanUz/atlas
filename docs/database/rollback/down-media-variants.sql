-- Optional: reverse 20261006000100_media_variants (not needed for a Phase 2
-- rollback — Phase 2 ignores the columns). Run last:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-media-variants.sql "$DATABASE_URL"
-- Display files referenced by "displayKey" stay on disk; remove them with the
-- storage sweep (dry run first).
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261006000100_media_variants' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

ALTER TABLE "WardrobeImage" DROP COLUMN "bytes", DROP COLUMN "displayKey", DROP COLUMN "mimeType", DROP COLUMN "sha256";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261006000100_media_variants';
