-- Reverse 20261126000000_wardrobe_child_indexes (indexes on the columns an
-- item's images and an outfit's entries are found by). Run it FIRST, before
-- down-rate-limit-bucket.sql, when rolling back further:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f down-wardrobe-child-indexes.sql "$DATABASE_URL"
-- No data is lost: only the indexes go, and with them the speed of wardrobe
-- lists and deletions on large tables.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE "migration_name" = '20261126000000_wardrobe_child_indexes' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION '20261126000000_wardrobe_child_indexes is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
              WHERE "migration_name" > '20261126000000_wardrobe_child_indexes' AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'later migrations are applied; roll those back first';
  END IF;
END $$;

DROP INDEX "WardrobeImage_wardrobeItemId_idx";
DROP INDEX "OutfitItem_outfitId_idx";
DROP INDEX "OutfitItem_wardrobeItemId_idx";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126000000_wardrobe_child_indexes';
