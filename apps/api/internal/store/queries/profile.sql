-- Profile (internal/profile): the user's profile and style preferences.
-- Until B7 the rows keep Prisma's shape: lists as JSON text, ids made by the
-- caller, times from the database clock in UTC.

-- name: UserProfileByUser :one
SELECT * FROM "UserProfile" WHERE "userId" = $1;

-- name: UserPreferencesByUser :one
SELECT * FROM "UserPreferences" WHERE "userId" = $1;

-- name: SetUserName :exec
UPDATE "User" SET "name" = sqlc.arg(name), "updatedAt" = atlas_now() WHERE "id" = sqlc.arg(id);

-- name: UpsertUserProfile :exec
-- Changes the fields whose set_* flag is true (to the value, or to NULL) and
-- leaves the others; creates the row, with those values, when the user has
-- none. The row's updatedAt moves either way.
INSERT INTO "UserProfile" ("id", "userId", "gender", "ageRange", "height", "weight", "bodyShape", "skinTone", "skinUndertone",
                           "hairColor", "eyeColor", "clothingSize", "preferredFit", "typicalBudget", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.narg(gender), sqlc.narg(age_range), sqlc.narg(height), sqlc.narg(weight),
        sqlc.narg(body_shape), sqlc.narg(skin_tone), sqlc.narg(skin_undertone), sqlc.narg(hair_color), sqlc.narg(eye_color),
        sqlc.narg(clothing_size), sqlc.narg(preferred_fit), sqlc.narg(typical_budget), atlas_now(), atlas_now())
ON CONFLICT ("userId") DO UPDATE SET
  "gender"        = CASE WHEN sqlc.arg(set_gender)::boolean         THEN EXCLUDED."gender"        ELSE "UserProfile"."gender" END,
  "ageRange"      = CASE WHEN sqlc.arg(set_age_range)::boolean      THEN EXCLUDED."ageRange"      ELSE "UserProfile"."ageRange" END,
  "height"        = CASE WHEN sqlc.arg(set_height)::boolean         THEN EXCLUDED."height"        ELSE "UserProfile"."height" END,
  "weight"        = CASE WHEN sqlc.arg(set_weight)::boolean         THEN EXCLUDED."weight"        ELSE "UserProfile"."weight" END,
  "bodyShape"     = CASE WHEN sqlc.arg(set_body_shape)::boolean     THEN EXCLUDED."bodyShape"     ELSE "UserProfile"."bodyShape" END,
  "skinTone"      = CASE WHEN sqlc.arg(set_skin_tone)::boolean      THEN EXCLUDED."skinTone"      ELSE "UserProfile"."skinTone" END,
  "skinUndertone" = CASE WHEN sqlc.arg(set_skin_undertone)::boolean THEN EXCLUDED."skinUndertone" ELSE "UserProfile"."skinUndertone" END,
  "hairColor"     = CASE WHEN sqlc.arg(set_hair_color)::boolean     THEN EXCLUDED."hairColor"     ELSE "UserProfile"."hairColor" END,
  "eyeColor"      = CASE WHEN sqlc.arg(set_eye_color)::boolean      THEN EXCLUDED."eyeColor"      ELSE "UserProfile"."eyeColor" END,
  "clothingSize"  = CASE WHEN sqlc.arg(set_clothing_size)::boolean  THEN EXCLUDED."clothingSize"  ELSE "UserProfile"."clothingSize" END,
  "preferredFit"  = CASE WHEN sqlc.arg(set_preferred_fit)::boolean  THEN EXCLUDED."preferredFit"  ELSE "UserProfile"."preferredFit" END,
  "typicalBudget" = CASE WHEN sqlc.arg(set_typical_budget)::boolean THEN EXCLUDED."typicalBudget" ELSE "UserProfile"."typicalBudget" END,
  "updatedAt"     = atlas_now();

-- name: UpsertUserPreferences :exec
-- Changes the fields that are given (not NULL) and leaves the others;
-- creates the row, with Prisma's defaults for the rest, when the user has
-- none. The row's updatedAt moves either way.
INSERT INTO "UserPreferences" ("id", "userId", "preferredStyles", "dislikedStyles", "favoriteColors", "dislikedColors", "language", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id),
        COALESCE(sqlc.narg(preferred_styles)::text, '[]'), COALESCE(sqlc.narg(disliked_styles)::text, '[]'),
        COALESCE(sqlc.narg(favorite_colors)::text, '[]'), COALESCE(sqlc.narg(disliked_colors)::text, '[]'),
        COALESCE(sqlc.narg(language)::text, 'uz'), atlas_now(), atlas_now())
ON CONFLICT ("userId") DO UPDATE SET
  "preferredStyles" = COALESCE(sqlc.narg(preferred_styles)::text, "UserPreferences"."preferredStyles"),
  "dislikedStyles"  = COALESCE(sqlc.narg(disliked_styles)::text, "UserPreferences"."dislikedStyles"),
  "favoriteColors"  = COALESCE(sqlc.narg(favorite_colors)::text, "UserPreferences"."favoriteColors"),
  "dislikedColors"  = COALESCE(sqlc.narg(disliked_colors)::text, "UserPreferences"."dislikedColors"),
  "language"        = COALESCE(sqlc.narg(language)::text, "UserPreferences"."language"),
  "updatedAt"       = atlas_now();
