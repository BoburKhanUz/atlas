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
-- Every version of the legal texts the user accepted.
SELECT "version" FROM "LegalConsent" WHERE "userId" = $1;
