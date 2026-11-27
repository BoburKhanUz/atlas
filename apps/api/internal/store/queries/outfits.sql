-- Outfits (internal/outfits): what the outfit engine reads, and the saved
-- outfits with their feedback. Until B7 the rows keep Prisma's shape: lists
-- as JSON text, ids made by the caller, times from the database clock in UTC.
-- Every query names the owner.

-- name: WardrobeForOutfits :many
-- The user's items as the engine reads them, in a fixed order. The limit is
-- above what a wardrobe may hold (wardrobe.MaxItems).
SELECT "id", "category", "subcategory", "colors", "pattern", "material", "sleeveLength", "fit", "style", "season",
       "gender", "formality"
  FROM "WardrobeItem" WHERE "userId" = sqlc.arg(user_id) ORDER BY "id" LIMIT sqlc.arg(row_limit);

-- name: ColorProfileOfUser :one
-- The colour profile the user's profile points to, when it is the user's.
SELECT c.* FROM "UserProfile" p JOIN "ColorProfile" c ON c."id" = p."colorProfileId" AND c."userId" = p."userId"
 WHERE p."userId" = $1;

-- name: RecentOutfitFeedback :many
-- Which of the user's outfits got which kind of feedback in the last days:
-- the newest first, so that what the limit leaves out is the oldest.
SELECT f."outfitId", f."feedback" FROM "OutfitFeedback" f
 WHERE f."userId" = sqlc.arg(user_id) AND f."createdAt" >= atlas_now() - sqlc.arg(days)::int * interval '1 day'
 GROUP BY f."outfitId", f."feedback"
 ORDER BY max(f."createdAt") DESC, f."outfitId", f."feedback" LIMIT sqlc.arg(row_limit);

-- name: ItemsOfOutfits :many
-- The items of the user's outfits named, in the order they were added.
SELECT oi."outfitId", w."id" AS item_id, w."category"
  FROM "OutfitItem" oi
  JOIN "Outfit" o ON o."id" = oi."outfitId" AND o."userId" = sqlc.arg(user_id)
  JOIN "WardrobeItem" w ON w."id" = oi."wardrobeItemId" AND w."userId" = sqlc.arg(user_id)
 WHERE oi."outfitId" = ANY(sqlc.arg(outfit_ids)::text[])
 ORDER BY oi."outfitId", oi."createdAt", oi."id";

-- name: LockItemsForOutfit :many
-- The user's items named, with their categories; they cannot be removed
-- until the transaction ends (an outfit is being made of them).
SELECT "id", "category" FROM "WardrobeItem"
 WHERE "id" = ANY(sqlc.arg(ids)::text[]) AND "userId" = sqlc.arg(user_id) FOR SHARE;

-- name: InsertOutfit :one
INSERT INTO "Outfit" ("id", "userId", "name", "occasion", "weatherSnapshot", "score", "reasonsJson", "explanation", "isSaved",
                      "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.narg(name), sqlc.narg(occasion), sqlc.arg(weather_snapshot), sqlc.narg(score),
        sqlc.arg(reasons_json), sqlc.narg(explanation), sqlc.arg(is_saved), atlas_now(), atlas_now())
RETURNING *;

-- name: InsertOutfitItem :one
-- The items of an outfit are read in the order of their times: each is a
-- millisecond after the one before (ids made here do not sort by time, as
-- Prisma's did).
INSERT INTO "OutfitItem" ("id", "outfitId", "wardrobeItemId", "role", "createdAt")
VALUES (sqlc.arg(id), sqlc.arg(outfit_id), sqlc.arg(wardrobe_item_id), sqlc.arg(role),
        atlas_now() + sqlc.arg(place)::int * interval '1 millisecond')
RETURNING *;

-- name: ListOutfits :many
-- The user's newest outfits, all or the saved ones.
SELECT * FROM "Outfit"
 WHERE "userId" = sqlc.arg(user_id) AND (NOT sqlc.arg(saved_only)::boolean OR "isSaved")
 ORDER BY "createdAt" DESC, "id" DESC LIMIT sqlc.arg(row_limit);

-- name: OutfitOfUser :one
SELECT * FROM "Outfit" WHERE "id" = $1 AND "userId" = $2;

-- name: LockOutfitOfUser :one
-- The outfit, locked until the transaction ends.
SELECT * FROM "Outfit" WHERE "id" = $1 AND "userId" = $2 FOR UPDATE;

-- name: GarmentsOfOutfits :many
-- The items of the user's outfits named, each with what is shown of its
-- garment, in the order they were added.
SELECT oi."id", oi."outfitId", oi."wardrobeItemId", oi."role",
       w."category", w."subcategory", w."colors", w."style", w."material", w."season"
  FROM "OutfitItem" oi
  JOIN "Outfit" o ON o."id" = oi."outfitId" AND o."userId" = sqlc.arg(user_id)
  JOIN "WardrobeItem" w ON w."id" = oi."wardrobeItemId" AND w."userId" = sqlc.arg(user_id)
 WHERE oi."outfitId" = ANY(sqlc.arg(outfit_ids)::text[])
 ORDER BY oi."outfitId", oi."createdAt", oi."id";

-- name: UpdateOutfit :one
-- Changes what is given: is_saved when it is not NULL, the name (to a text
-- or to NULL) when set_name is true. The row's updatedAt moves either way,
-- as Prisma moved it.
UPDATE "Outfit"
   SET "isSaved"   = COALESCE(sqlc.narg(is_saved)::boolean, "isSaved"),
       "name"      = CASE WHEN sqlc.arg(set_name)::boolean THEN sqlc.narg(name) ELSE "name" END,
       "updatedAt" = atlas_now()
 WHERE "id" = sqlc.arg(id) AND "userId" = sqlc.arg(user_id)
RETURNING *;

-- name: DeleteOutfit :execrows
-- The outfit's items and feedback go with it (foreign keys).
DELETE FROM "Outfit" WHERE "id" = $1 AND "userId" = $2;

-- name: InsertOutfitFeedback :one
INSERT INTO "OutfitFeedback" ("id", "userId", "outfitId", "feedback", "note", "createdAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(outfit_id), sqlc.arg(feedback), sqlc.narg(note), atlas_now())
RETURNING *;

-- name: SetOutfitSaved :exec
UPDATE "Outfit" SET "isSaved" = sqlc.arg(is_saved), "updatedAt" = atlas_now()
 WHERE "id" = sqlc.arg(id) AND "userId" = sqlc.arg(user_id);
