-- Media variants (display WebP + upload metadata). Additive and nullable:
-- the Phase 2 build ignores these columns (see docs/database/cutover.md).

-- AlterTable
ALTER TABLE "WardrobeImage" ADD COLUMN     "bytes" INTEGER,
ADD COLUMN     "displayKey" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sha256" TEXT;
