-- Wardrobe (internal/wardrobe): a user's items and their images. Until B7
-- the rows keep Prisma's shape: lists and objects as JSON text, ids made by
-- the caller, times in UTC. Every query names the owner: an item of another
-- user is not found.

-- name: WardrobeNow :one
-- The time of a change: the database clock.
SELECT atlas_now()::timestamp(3) AS now;

-- name: ListWardrobeItems :many
-- A page of the user's items, newest first, then by id. With a cursor, the
-- items after that item of the user's in this order; a cursor that is not
-- one of the user's items matches nothing (the subquery is NULL).
SELECT * FROM "WardrobeItem" i
 WHERE i."userId" = sqlc.arg(user_id)
   AND (sqlc.narg(category)::text IS NULL OR i."category" = sqlc.narg(category)::text)
   AND (sqlc.narg(cursor_id)::text IS NULL
        OR (i."createdAt", i."id") < (SELECT c."createdAt", c."id" FROM "WardrobeItem" c
                                       WHERE c."id" = sqlc.narg(cursor_id)::text AND c."userId" = sqlc.arg(user_id)))
 ORDER BY i."createdAt" DESC, i."id" DESC
 LIMIT sqlc.arg(row_limit);

-- name: WardrobeItemOfUser :one
SELECT * FROM "WardrobeItem" WHERE "id" = $1 AND "userId" = $2;

-- name: LockWardrobeItemOfUser :one
-- The item, locked until the transaction ends: its changes go one at a time.
SELECT * FROM "WardrobeItem" WHERE "id" = $1 AND "userId" = $2 FOR UPDATE;

-- name: WardrobeImagesOfItems :many
-- In the order they were added (Prisma read them without an order; rows are
-- returned in insertion order in practice).
SELECT * FROM "WardrobeImage" WHERE "wardrobeItemId" = ANY(sqlc.arg(item_ids)::text[])
 ORDER BY "createdAt", "id";

-- name: UpdateWardrobeItem :one
-- Writes the fields whose set_* flag is true (to the value, or to NULL),
-- marks the item corrected with its new log, and moves updatedAt.
UPDATE "WardrobeItem" SET
  "category"      = CASE WHEN sqlc.arg(set_category)::boolean      THEN sqlc.arg(category)::text          ELSE "category" END,
  "subcategory"   = CASE WHEN sqlc.arg(set_subcategory)::boolean   THEN sqlc.narg(subcategory)::text      ELSE "subcategory" END,
  "colors"        = CASE WHEN sqlc.arg(set_colors)::boolean        THEN sqlc.arg(colors)::text            ELSE "colors" END,
  "pattern"       = CASE WHEN sqlc.arg(set_pattern)::boolean       THEN sqlc.narg(pattern)::text          ELSE "pattern" END,
  "material"      = CASE WHEN sqlc.arg(set_material)::boolean      THEN sqlc.narg(material)::text         ELSE "material" END,
  "sleeveLength"  = CASE WHEN sqlc.arg(set_sleeve_length)::boolean THEN sqlc.narg(sleeve_length)::text    ELSE "sleeveLength" END,
  "fit"           = CASE WHEN sqlc.arg(set_fit)::boolean           THEN sqlc.narg(fit)::text              ELSE "fit" END,
  "style"         = CASE WHEN sqlc.arg(set_style)::boolean         THEN sqlc.narg(style)::text            ELSE "style" END,
  "season"        = CASE WHEN sqlc.arg(set_season)::boolean        THEN sqlc.arg(season)::text            ELSE "season" END,
  "gender"        = CASE WHEN sqlc.arg(set_gender)::boolean        THEN sqlc.narg(gender)::text           ELSE "gender" END,
  "formality"     = CASE WHEN sqlc.arg(set_formality)::boolean     THEN sqlc.narg(formality)::text        ELSE "formality" END,
  "wasCorrected"  = true,
  "correctionLog" = sqlc.arg(correction_log)::text,
  "updatedAt"     = sqlc.arg(updated_at)::timestamp(3)
 WHERE "id" = sqlc.arg(id)
RETURNING *;

-- name: DeleteWardrobeItem :exec
-- Its images and outfit entries go with it (ON DELETE CASCADE).
DELETE FROM "WardrobeItem" WHERE "id" = $1;

-- name: CountWardrobeItemsOfUser :one
SELECT count(*) FROM "WardrobeItem" WHERE "userId" = $1;

-- name: InsertWardrobeItem :one
-- An item as an upload creates it: the detected attributes, nothing
-- corrected yet, and who analysed the photo.
INSERT INTO "WardrobeItem" ("id", "userId", "category", "subcategory", "colors", "pattern", "material", "sleeveLength", "fit", "style",
                            "season", "gender", "formality", "confidences", "wasCorrected", "correctionLog",
                            "analysisProvider", "analysisModel", "analysisVersion", "analyzedAt", "analysisRawConfidences",
                            "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(category), sqlc.narg(subcategory), sqlc.arg(colors), sqlc.narg(pattern),
        sqlc.narg(material), sqlc.narg(sleeve_length), sqlc.narg(fit), sqlc.narg(style), sqlc.arg(season), sqlc.narg(gender),
        sqlc.narg(formality), sqlc.arg(confidences), false, '[]',
        sqlc.arg(analysis_provider), sqlc.arg(analysis_model), sqlc.arg(analysis_version), atlas_now(), NULL,
        atlas_now(), atlas_now())
RETURNING *;

-- name: InsertWardrobeImage :exec
INSERT INTO "WardrobeImage" ("id", "wardrobeItemId", "storageKey", "displayKey", "thumbnailKey", "isPrimary", "width", "height",
                             "mimeType", "bytes", "sha256", "createdAt")
VALUES (sqlc.arg(id), sqlc.arg(item_id), sqlc.arg(storage_key), sqlc.arg(display_key), sqlc.arg(thumbnail_key), true,
        sqlc.arg(width), sqlc.arg(height), sqlc.arg(mime_type), sqlc.arg(bytes), sqlc.arg(sha256), atlas_now());
