-- The session protocol (docs/architecture/sessions.md), run by
-- internal/session in one read-committed transaction per request. Lock
-- order, always: the family, then the session, then its successor.

-- name: SessionNow :one
-- The request time: the database clock, read before any lock wait.
SELECT atlas_now()::timestamp(3) AS now;

-- name: FindSessionByTokenHash :one
-- No lock: this only finds the family to lock first.
SELECT "id", "familyId" FROM "Session" WHERE "tokenHash" = $1;

-- name: FindSessionFamilyOfUser :one
-- Sign-out by an access token's session id, scoped to its user.
SELECT "familyId" FROM "Session" WHERE "id" = $1 AND "userId" = $2;

-- name: LockSessionFamily :one
SELECT "id", "userId", "clientType", "absoluteExpiresAt", "revokedAt"
  FROM "SessionFamily" WHERE "id" = $1 FOR UPDATE;

-- name: LockSession :one
SELECT "id", "userId", "familyId", "tokenHash", "expiresAt", "revokedAt", "replacedById",
       "rotatedAt", "rotatedAtSource", "successorTokenEnc", "userAgent", "deviceName"
  FROM "Session" WHERE "id" = $1 FOR UPDATE;

-- name: LegacyCutoverAt :one
SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt';

-- name: SessionUser :one
SELECT "id", "email", "name" FROM "User" WHERE "id" = $1;

-- name: CreateSessionFamily :exec
INSERT INTO "SessionFamily" ("id", "userId", "clientType", "createdAt", "absoluteExpiresAt")
VALUES ($1, $2, $3, $4, $5);

-- name: CreateSession :exec
INSERT INTO "Session" ("id", "userId", "familyId", "tokenHash", "createdAt", "lastUsedAt", "expiresAt", "userAgent", "deviceName")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(family_id), sqlc.arg(token_hash), sqlc.arg(at), sqlc.arg(at), sqlc.arg(expires_at),
        sqlc.narg(user_agent), sqlc.narg(device_name));

-- name: MarkSessionRotated :exec
-- The presented session becomes a rotated one: revoked, pointing at its
-- successor, holding the successor's token encrypted for a grace replay.
UPDATE "Session"
   SET "revokedAt" = sqlc.arg(at)::timestamp, "rotatedAt" = sqlc.arg(at)::timestamp, "rotatedAtSource" = 'db',
       "lastUsedAt" = sqlc.arg(at)::timestamp,
       "replacedById" = sqlc.arg(successor_id)::text, "successorTokenEnc" = sqlc.arg(successor_token_enc)::text
 WHERE "id" = sqlc.arg(id);

-- name: RevokeSessionFamily :exec
-- The caller holds the family lock. The first reason stays.
UPDATE "SessionFamily" SET "revokedAt" = sqlc.arg(at)::timestamp, "revokeReason" = sqlc.arg(reason)::text
 WHERE "id" = sqlc.arg(id) AND "revokedAt" IS NULL;

-- name: RevokeSessionsOfFamily :exec
-- Every live session of a revoked family is stamped, so session rows alone
-- are always enough to enforce the revocation.
UPDATE "Session" SET "revokedAt" = sqlc.arg(at)::timestamp WHERE "familyId" = sqlc.arg(family_id) AND "revokedAt" IS NULL;

-- name: ClearSuccessorCiphertextsOfFamily :exec
UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "familyId" = $1 AND "successorTokenEnc" IS NOT NULL;

-- name: LockSessionFamiliesOfUser :many
-- Every family of the user, live or not, in id order: what changes all of a
-- user's sessions (a password reset, the account's deletion) takes these
-- locks first, as a refresh takes its family's lock first.
SELECT "id" FROM "SessionFamily" WHERE "userId" = $1 ORDER BY "id" FOR UPDATE;

-- name: LockLiveSessionFamiliesOfUser :many
-- In id order, so two revocations of one user's families never deadlock.
SELECT "id" FROM "SessionFamily" WHERE "userId" = $1 AND "revokedAt" IS NULL ORDER BY "id" FOR UPDATE;

-- name: SessionIsAlive :one
-- Whether an access token's session still stands, checked on every
-- authenticated request: its family is not revoked (sign-out, reuse, expiry,
-- password reset), and the session itself is live or was only rotated. A
-- rotated session's access token stays good until it expires, so requests
-- in flight during a refresh are not refused.
SELECT EXISTS (
  SELECT 1
    FROM "Session" s
    JOIN "SessionFamily" f ON f."id" = s."familyId"
   WHERE s."id" = sqlc.arg(id) AND s."userId" = sqlc.arg(user_id)
     AND f."revokedAt" IS NULL
     AND (s."revokedAt" IS NULL OR s."replacedById" IS NOT NULL)
) AS alive;
