-- Who analysed each wardrobe photo (Phase 4.1: real vision providers).
-- Additive, nullable columns; older builds ignore them.

-- AlterTable
ALTER TABLE "WardrobeItem" ADD COLUMN     "analysisModel" TEXT,
ADD COLUMN     "analysisProvider" TEXT,
ADD COLUMN     "analysisRawConfidences" TEXT,
ADD COLUMN     "analysisVersion" TEXT,
ADD COLUMN     "analyzedAt" TIMESTAMP(3);

-- Every item stored before this migration was analysed by the deterministic
-- mock (the only analyser that existed): record that explicitly instead of
-- leaving it to be inferred from NULL.
UPDATE "WardrobeItem"
SET "analysisProvider" = 'mock',
    "analysisModel" = 'mock-vision',
    "analysisVersion" = 'pre-4.1',
    "analyzedAt" = "createdAt";
