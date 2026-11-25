-- name: LockDeadFamilies :exec
-- Families revoked, or past their absolute limit, for more than 30 days,
-- locked in id order BEFORE any session row: the session protocol locks a
-- family first, then its sessions (docs/architecture/sessions.md), so the
-- cleanup never holds a session while waiting for its family.
SELECT "id" FROM "SessionFamily"
 WHERE "revokedAt" < atlas_now() - interval '30 days'
    OR "absoluteExpiresAt" < atlas_now() - interval '30 days'
 ORDER BY "id"
   FOR UPDATE;

-- name: ClearStaleSuccessorCiphertexts :execrows
-- A ciphertext only serves a replay within 60 s of its rotation.
--
-- These rows belong to live families too, whose family lock the cleanup does
-- not hold. SKIP LOCKED: a row someone holds (a refresh or a revocation of
-- that family, which clears its ciphertexts itself) is left to them or to
-- the next run, so the cleanup never waits for a session row while it holds
-- another one.
UPDATE "Session" SET "successorTokenEnc" = NULL
 WHERE "id" IN (
   SELECT "id" FROM "Session"
    WHERE "successorTokenEnc" IS NOT NULL
      AND "rotatedAt" < atlas_now() - interval '60 seconds'
    ORDER BY "id"
      FOR UPDATE SKIP LOCKED);

-- name: DeleteOldRotatedSessions :execrows
-- Rotated rows (never a live tail) rotated more than 30 days ago, of families
-- that are not themselves deleted below. SKIP LOCKED for the same reason.
DELETE FROM "Session"
 WHERE "id" IN (
   SELECT "id" FROM "Session"
    WHERE "replacedById" IS NOT NULL
      AND "revokedAt" < atlas_now() - interval '30 days'
      AND "familyId" NOT IN (
        SELECT "id" FROM "SessionFamily"
         WHERE "revokedAt" < atlas_now() - interval '30 days'
            OR "absoluteExpiresAt" < atlas_now() - interval '30 days')
    ORDER BY "id"
      FOR UPDATE SKIP LOCKED);

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

-- name: DeleteExpiredRateLimitBuckets :execrows
-- Windows that have ended. SKIP LOCKED: a bucket an attempt is using right
-- now is left to the next run, so the cleanup never waits for a row while it
-- holds another (an attempt locks several buckets, in key order).
DELETE FROM "RateLimitBucket"
 WHERE "key" IN (
   SELECT "key" FROM "RateLimitBucket"
    WHERE "resetAt" <= atlas_now()
    ORDER BY "key"
      FOR UPDATE SKIP LOCKED);
