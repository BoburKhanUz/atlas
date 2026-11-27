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
-- Which of the user's outfits got which kind of feedback in the last days.
SELECT DISTINCT f."outfitId", f."feedback" FROM "OutfitFeedback" f
 WHERE f."userId" = sqlc.arg(user_id) AND f."createdAt" >= atlas_now() - sqlc.arg(days)::int * interval '1 day'
 ORDER BY f."outfitId", f."feedback" LIMIT sqlc.arg(row_limit);

-- name: ItemsOfOutfits :many
-- The items of the user's outfits named, in the order they were added.
SELECT oi."outfitId", w."id" AS item_id, w."category"
  FROM "OutfitItem" oi
  JOIN "Outfit" o ON o."id" = oi."outfitId" AND o."userId" = sqlc.arg(user_id)
  JOIN "WardrobeItem" w ON w."id" = oi."wardrobeItemId" AND w."userId" = sqlc.arg(user_id)
 WHERE oi."outfitId" = ANY(sqlc.arg(outfit_ids)::text[])
 ORDER BY oi."outfitId", oi."createdAt", oi."id";
