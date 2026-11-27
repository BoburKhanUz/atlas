-- The weather cache (internal/weather): one row a cell (the coordinates
-- rounded to two decimals), shared with the Next.js API until the cutover.
-- Expired rows are removed by the cleanup (maintenance.sql).

-- name: FreshWeather :one
SELECT "dataJson" FROM "WeatherCache" WHERE "cacheKey" = sqlc.arg(cache_key) AND "expiresAt" > atlas_now();

-- name: StoreWeather :exec
INSERT INTO "WeatherCache" (id, "cacheKey", "dataJson", "fetchedAt", "expiresAt")
VALUES (sqlc.arg(id), sqlc.arg(cache_key), sqlc.arg(data_json), atlas_now(),
        atlas_now() + sqlc.arg(ttl_ms)::bigint * interval '1 millisecond')
ON CONFLICT ("cacheKey") DO UPDATE
   SET "dataJson" = EXCLUDED."dataJson", "fetchedAt" = EXCLUDED."fetchedAt", "expiresAt" = EXCLUDED."expiresAt";
