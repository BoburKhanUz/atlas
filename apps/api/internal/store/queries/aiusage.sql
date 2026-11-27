-- The daily AI quotas (internal/quota): one counter per user, feature and
-- day. The day is the calendar day in Uzbekistan (UTC+5, no daylight
-- saving), on the database clock.

-- name: ChargeAIUsage :one
-- Counts one call unless the day's limit is reached, in one statement, so
-- that requests at the same moment can never pass the limit. "count" is the
-- day's count with this call, or 0 when the call was refused (nothing is
-- counted then). "day" is the day charged: a refund names it.
WITH clock AS (
  SELECT atlas_now() + interval '5 hours' AS local
), charged AS (
  INSERT INTO "AiUsage" AS u ("id", "userId", "feature", "day", "count", "updatedAt")
  SELECT sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(feature), clock.local::date, 1, atlas_now() FROM clock
  ON CONFLICT ("userId", "feature", "day") DO UPDATE
     SET "count" = u."count" + 1, "updatedAt" = atlas_now()
   WHERE u."count" < sqlc.arg(day_limit)::int
  RETURNING u."count"
)
SELECT clock.local::date AS day,
       -- Whole seconds, rounded up: never zero, the next midnight is always ahead.
       CEIL(EXTRACT(EPOCH FROM (clock.local::date + 1)::timestamp - clock.local))::int AS seconds_until_next_day,
       COALESCE((SELECT "count" FROM charged), 0)::int AS count
  FROM clock;

-- name: RefundAIUsage :exec
-- Gives one call of a day back. Never below zero.
UPDATE "AiUsage" SET "count" = "count" - 1, "updatedAt" = atlas_now()
 WHERE "userId" = $1 AND "feature" = $2 AND "day" = $3 AND "count" > 0;
