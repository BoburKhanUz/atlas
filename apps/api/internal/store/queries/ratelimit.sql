-- The rate limiter (internal/ratelimit): fixed windows on the database
-- clock. A row past its "resetAt" is dead and is reused by the next attempt.

-- name: TakeRateLimit :one
-- Counts one attempt and returns the new count: the caller compares it with
-- the limit and rolls back when it is over, so a refused attempt is never
-- counted. The window starts at the first attempt and is not moved by later
-- ones.
INSERT INTO "RateLimitBucket" AS b ("key", "count", "resetAt")
VALUES (sqlc.arg(key), 1, atlas_now() + sqlc.arg(window_ms)::bigint * interval '1 millisecond')
ON CONFLICT ("key") DO UPDATE
   SET "count"   = CASE WHEN b."resetAt" <= atlas_now() THEN 1 ELSE b."count" + 1 END,
       "resetAt" = CASE WHEN b."resetAt" <= atlas_now()
                        THEN atlas_now() + sqlc.arg(window_ms)::bigint * interval '1 millisecond'
                        ELSE b."resetAt" END
RETURNING "count", "resetAt", atlas_now()::timestamp(3) AS now;

-- name: RefundRateLimit :exec
-- Gives one attempt back (a successful sign-in is not counted). Never below
-- zero, and never in a window that has ended.
UPDATE "RateLimitBucket" SET "count" = "count" - 1
 WHERE "key" = $1 AND "count" > 0 AND "resetAt" > atlas_now();
