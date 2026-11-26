-- Accounts (internal/accounts): registration, sign-in, the signed-in user.
-- Until B7 the ids and timestamps Prisma generated are written here: ids by
-- the caller, times from the database clock in UTC.

-- name: UserByEmail :one
SELECT "id", "email", "name", "passwordHash" FROM "User" WHERE "email" = $1;

-- name: UserByID :one
SELECT "id", "email", "name", "createdAt" FROM "User" WHERE "id" = $1;

-- name: CreateUser :exec
INSERT INTO "User" ("id", "email", "name", "passwordHash", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(email), sqlc.narg(name), sqlc.arg(password_hash), atlas_now(), atlas_now());

-- name: CreateUserProfile :exec
INSERT INTO "UserProfile" ("id", "userId", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), atlas_now(), atlas_now());

-- name: CreateUserPreferences :exec
INSERT INTO "UserPreferences" ("id", "userId", "preferredStyles", "dislikedStyles", "favoriteColors", "dislikedColors", "language", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), '[]', '[]', '[]', '[]', 'uz', atlas_now(), atlas_now());

-- name: CreateLegalConsent :exec
INSERT INTO "LegalConsent" ("id", "userId", "version", "ageConfirmed", "acceptedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(version), sqlc.arg(age_confirmed), atlas_now());

-- name: ReplacePasswordHash :execrows
-- A stronger hash of the same password, after a successful sign-in. Only if
-- the stored hash is still the one that was verified: a password changed in
-- between is not overwritten.
UPDATE "User" SET "passwordHash" = sqlc.arg(new_hash), "updatedAt" = atlas_now()
 WHERE "id" = sqlc.arg(id) AND "passwordHash" = sqlc.arg(old_hash);

-- name: ConsentVersions :many
-- The versions of the legal texts the user accepted, the newest consents
-- first, at most "limit" of them.
SELECT "version" FROM "LegalConsent" WHERE "userId" = sqlc.arg(user_id)
 ORDER BY "acceptedAt" DESC, "id" DESC LIMIT sqlc.arg('limit');

-- name: ConsentRecorded :one
SELECT EXISTS (SELECT 1 FROM "LegalConsent" WHERE "userId" = sqlc.arg(user_id) AND "version" = sqlc.arg(version));

-- name: LockUser :one
-- The user's row, locked until the transaction ends: what changes an
-- account goes one request at a time (consent, profile, password reset),
-- and not while the account is being deleted. NO KEY: a session being
-- created for the user meanwhile (its foreign key) is not held up, so a
-- refresh in flight cannot deadlock with a password reset.
SELECT "id" FROM "User" WHERE "id" = $1 FOR NO KEY UPDATE;

-- Password reset links (password reset by e-mail). Only the hash of a
-- link's token is stored.

-- name: ResetTokenUser :one
SELECT "userId" FROM "PasswordResetToken" WHERE "tokenHash" = $1;

-- name: LockResetToken :one
SELECT "expiresAt" FROM "PasswordResetToken" WHERE "tokenHash" = $1 FOR UPDATE;

-- name: CreateResetToken :exec
-- A link that works from now (the database clock) for ttl_seconds.
INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "createdAt", "expiresAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(token_hash), atlas_now(),
        atlas_now() + make_interval(secs => sqlc.arg(ttl_seconds)::double precision));

-- name: DeleteEarlierResetTokens :exec
-- The user's links made before the given one (by time, then id), once that
-- one has left. A link made after it stays: two jobs for one user at the
-- same time must not end each other's link.
DELETE FROM "PasswordResetToken" AS earlier USING "PasswordResetToken" AS sent
 WHERE sent."tokenHash" = sqlc.arg(sent_token_hash) AND earlier."userId" = sent."userId"
   AND (earlier."createdAt", earlier."id") < (sent."createdAt", sent."id");

-- name: DeleteResetTokensOfUser :exec
DELETE FROM "PasswordResetToken" WHERE "userId" = $1;

-- name: DeleteResetToken :exec
DELETE FROM "PasswordResetToken" WHERE "tokenHash" = $1;

-- name: SetPasswordHash :exec
UPDATE "User" SET "passwordHash" = sqlc.arg(password_hash), "updatedAt" = atlas_now() WHERE "id" = sqlc.arg(id);

-- name: DeleteUser :execrows
-- The schema completes it: every row the user owns goes with it (ON DELETE
-- CASCADE; a test walks the foreign keys).
DELETE FROM "User" WHERE "id" = $1;
