-- Phase 4.3: colour profile v2 (deterministic analysis "color-analysis-v2").
--
-- 1. One current profile per user. Earlier builds inserted a new row for
--    every analysis; only the row the user's profile points to was ever
--    read. The others are selfie-derived data with no use, so they are
--    deleted (the current one is kept), then userId becomes unique.
-- 2. Version and confidence columns. Existing rows are labelled
--    "color-heuristic-v1" with unknown (null) confidences, and their raw
--    colour averages in analysisJson are dropped (data minimisation; nothing
--    read them).

DELETE FROM "ColorProfile" cp
WHERE NOT EXISTS (SELECT 1 FROM "UserProfile" up WHERE up."colorProfileId" = cp."id");

-- Defensive: if a user still has several rows, keep the newest.
DELETE FROM "ColorProfile" a
USING "ColorProfile" b
WHERE a."userId" = b."userId" AND (a."createdAt", a."id") < (b."createdAt", b."id");

DROP INDEX "ColorProfile_userId_idx";
CREATE UNIQUE INDEX "ColorProfile_userId_key" ON "ColorProfile"("userId");

ALTER TABLE "ColorProfile"
  ADD COLUMN "analysisVersion" TEXT,
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "undertoneConfidence" DOUBLE PRECISION,
  ADD COLUMN "secondarySeason" TEXT,
  ADD COLUMN "secondaryConfidence" DOUBLE PRECISION;

UPDATE "ColorProfile" SET "analysisVersion" = 'color-heuristic-v1', "analysisJson" = '{}';
