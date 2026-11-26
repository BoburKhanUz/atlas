-- Idempotency keys (internal/idempotency): one row per user, route and
-- Idempotency-Key for 24 hours, so that a retried request creates its
-- resource once. The rows are the Next.js API's
-- (apps/web/src/server/idempotency.ts); both servers read and write them
-- until the cutover.

-- name: DeleteExpiredIdempotencyKeysOfUser :exec
-- A reused key that has expired starts fresh.
DELETE FROM "IdempotencyKey" WHERE "userId" = $1 AND "expiresAt" <= atlas_now();

-- name: ClaimIdempotencyKey :one
-- Exactly one of several requests with the key inserts the row; the others
-- get no row back. createdAt identifies the claim.
INSERT INTO "IdempotencyKey" ("id", "userId", "route", "key", "requestHash", "status", "createdAt", "expiresAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(route), sqlc.arg(key), sqlc.arg(request_hash), 'in_progress',
        atlas_now(), atlas_now() + sqlc.arg(ttl_ms)::bigint * interval '1 millisecond')
ON CONFLICT ("userId", "route", "key") DO NOTHING
RETURNING "createdAt";

-- name: IdempotencyKeyOfRequest :one
SELECT * FROM "IdempotencyKey" WHERE "userId" = $1 AND "route" = $2 AND "key" = $3;

-- name: TakeOverIdempotencyKey :one
-- A claim whose request has not finished for stale_ms (it crashed) passes
-- to the next request with the key; the new createdAt identifies the new
-- claim, so the old owner can no longer complete or release it.
UPDATE "IdempotencyKey"
   SET "createdAt" = atlas_now(), "expiresAt" = atlas_now() + sqlc.arg(ttl_ms)::bigint * interval '1 millisecond'
 WHERE "id" = sqlc.arg(id) AND "status" = 'in_progress'
   AND "createdAt" <= atlas_now() - sqlc.arg(stale_ms)::bigint * interval '1 millisecond'
RETURNING "createdAt";

-- name: CompleteIdempotencyKey :execrows
-- Only by the request that still holds the claim.
UPDATE "IdempotencyKey" SET "status" = 'completed', "resourceId" = sqlc.arg(resource_id), "responseStatus" = sqlc.arg(response_status)
 WHERE "id" = sqlc.arg(id) AND "status" = 'in_progress' AND "createdAt" = sqlc.arg(claimed_at);

-- name: ReleaseIdempotencyKey :exec
-- Forgets a failed attempt, so that a retry runs; only by the request that
-- still holds the claim.
DELETE FROM "IdempotencyKey" WHERE "id" = sqlc.arg(id) AND "status" = 'in_progress' AND "createdAt" = sqlc.arg(claimed_at);
