-- The selfie colour profile (apps/web/src/app/api/v1/color-profile): one
-- per user, replaced by each analysis.

-- name: SaveColorProfile :one
-- The user's colour profile, made or replaced; analysed now.
INSERT INTO "ColorProfile" ("id", "userId", "undertone", "season", "contrastLevel", "recommendedColors", "neutralColors",
                            "cautionColors", "analysisJson", "analysisVersion", "confidence", "undertoneConfidence",
                            "secondarySeason", "secondaryConfidence", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(undertone), sqlc.narg(season), sqlc.narg(contrast_level),
        sqlc.arg(recommended_colors), sqlc.arg(neutral_colors), sqlc.arg(caution_colors), sqlc.arg(analysis_json),
        sqlc.arg(analysis_version), sqlc.arg(confidence), sqlc.arg(undertone_confidence), sqlc.narg(secondary_season),
        sqlc.narg(secondary_confidence), atlas_now(), atlas_now())
ON CONFLICT ("userId") DO UPDATE SET
  "undertone" = EXCLUDED."undertone", "season" = EXCLUDED."season", "contrastLevel" = EXCLUDED."contrastLevel",
  "recommendedColors" = EXCLUDED."recommendedColors", "neutralColors" = EXCLUDED."neutralColors",
  "cautionColors" = EXCLUDED."cautionColors", "analysisJson" = EXCLUDED."analysisJson",
  "analysisVersion" = EXCLUDED."analysisVersion", "confidence" = EXCLUDED."confidence",
  "undertoneConfidence" = EXCLUDED."undertoneConfidence", "secondarySeason" = EXCLUDED."secondarySeason",
  "secondaryConfidence" = EXCLUDED."secondaryConfidence", "createdAt" = atlas_now(), "updatedAt" = atlas_now()
RETURNING "id", "createdAt";

-- name: PointProfileAtColors :exec
-- The user profile, made when there is none, points at the colour profile
-- and holds what the selfie gave.
INSERT INTO "UserProfile" ("id", "userId", "skinTone", "skinUndertone", "hairColor", "eyeColor", "colorProfileId", "createdAt", "updatedAt")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(skin_tone), sqlc.arg(skin_undertone), sqlc.narg(hair_color),
        sqlc.narg(eye_color), sqlc.arg(color_profile_id), atlas_now(), atlas_now())
ON CONFLICT ("userId") DO UPDATE SET
  "skinTone" = EXCLUDED."skinTone", "skinUndertone" = EXCLUDED."skinUndertone", "hairColor" = EXCLUDED."hairColor",
  "eyeColor" = EXCLUDED."eyeColor", "colorProfileId" = EXCLUDED."colorProfileId", "updatedAt" = atlas_now();

-- name: DeleteColorProfileOfUser :exec
DELETE FROM "ColorProfile" WHERE "userId" = $1;

-- name: ForgetColorsOfProfile :exec
-- What the selfie gave, gone from the user profile.
UPDATE "UserProfile" SET "colorProfileId" = NULL, "skinTone" = NULL, "skinUndertone" = NULL, "hairColor" = NULL,
       "eyeColor" = NULL, "updatedAt" = atlas_now()
 WHERE "userId" = $1;
