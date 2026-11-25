-- name: ClearStaleSuccessorCiphertexts :execrows
-- A ciphertext only serves a replay within 60 s of its rotation.
UPDATE "Session" SET "successorTokenEnc" = NULL
 WHERE "successorTokenEnc" IS NOT NULL
   AND "rotatedAt" < atlas_now() - interval '60 seconds';

-- name: DeleteOldRotatedSessions :execrows
-- Rotated rows (never a live tail) rotated more than 30 days ago, of families
-- that are not themselves deleted below.
DELETE FROM "Session"
 WHERE "replacedById" IS NOT NULL
   AND "revokedAt" < atlas_now() - interval '30 days'
   AND "familyId" NOT IN (
     SELECT "id" FROM "SessionFamily"
      WHERE "revokedAt" < atlas_now() - interval '30 days'
         OR "absoluteExpiresAt" < atlas_now() - interval '30 days');

-- name: CountSessionsOfDeadFamilies :one
SELECT count(*) FROM "Session"
 WHERE "familyId" IN (
   SELECT "id" FROM "SessionFamily"
    WHERE "revokedAt" < atlas_now() - interval '30 days'
       OR "absoluteExpiresAt" < atlas_now() - interval '30 days');

-- name: DeleteDeadFamilies :execrows
-- Families revoked, or past their absolute limit, for more than 30 days;
-- their sessions go with them (ON DELETE CASCADE).
DELETE FROM "SessionFamily"
 WHERE "revokedAt" < atlas_now() - interval '30 days'
    OR "absoluteExpiresAt" < atlas_now() - interval '30 days';

-- name: DeleteExpiredResetTokens :execrows
DELETE FROM "PasswordResetToken" WHERE "expiresAt" <= atlas_now();

-- name: DeleteExpiredIdempotencyKeys :execrows
DELETE FROM "IdempotencyKey" WHERE "expiresAt" <= atlas_now();

-- name: DeleteExpiredWeatherCache :execrows
DELETE FROM "WeatherCache" WHERE "expiresAt" <= atlas_now();
