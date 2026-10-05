# Phase 1 changes

Phase 1 hardened the imported Z.ai export into a safe, reproducible baseline. No new product features.

## Decisions

- Keep the Next.js API for the MVP; no Go migration yet. Keep modules bounded so a later migration is possible.
- A separate Python/FastAPI AI service only when needed.
- No AI provider is locked in.
- Weather sits behind a provider interface (Open-Meteo default; verify its terms before commercial launch).
- Preserve the mobile-first design; make it responsive for desktop later.
- Repo stays private during development.

## Import

Source imported from the Z.ai export into `apps/web` in one clean import. Excluded on purpose: `.git` history, `.env`, `db/custom.db` (3 real accounts, password hashes, conversations), `public/uploads` (25 user photos), `download/` screenshots, `.zscripts/`, `Caddyfile` (Z.ai gateway with an open port-forwarding rule), `tests/*.sh` (Z.ai runtime scripts), `examples/`, `mini-services/`. The worklog is kept at `docs/history/zai-worklog.md`.

## Correctness

1. **TypeScript:** 15 type errors fixed; `typescript.ignoreBuildErrors` removed, so the build type-checks.
2. **Outfit save bug:** `POST /api/v1/outfits` returned 500 whenever a weather object was sent (Zod 4 `z.record` needs key and value schemas). Fixed; save, like and dislike work.
3. **Stylist chat bug:** chat passed incomplete wardrobe objects (no id/pattern/fit/formality) to the recommendation engine. It now passes full DB rows. Partial client weather is ignored by the engine (`isCompleteWeather`).

## Security

4. **Secrets:** hard-coded JWT fallback secret removed. `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MEDIA_SIGNING_SECRET` are required, >= 32 chars, distinct; known old defaults are rejected. The server exits at startup (`instrumentation.ts`) if misconfigured. JWT verification is pinned to HS256.
5. **Private uploads:** no longer in `public/`. Stored under `STORAGE_LOCAL_DIR` (default `./storage/uploads`) with keys `users/<userId>/<uuid>.<ext>`; DB columns `WardrobeImage.storageKey` / `thumbnailKey`. The API returns HMAC-signed expiring URLs `/api/v1/media/<key>?exp=&sig=` (TTL `MEDIA_URL_TTL_SECONDS`, default 3600). Image format is detected from bytes via sharp (non-images get 422), with EXIF rotation, a 40MP pixel limit and path-traversal-safe keys.
6. **Privacy/deletion:** deleting a wardrobe item deletes its files. Deleting the account cascades to all rows, including `AiMemory` and `ColorProfile` (now owned by the user; previously orphaned), and deletes the user's storage directory.
7. **Rate limiting (in-memory, per process):** login 10 attempts / 15 min per email, 50 per IP and 1000 globally; register 10 / hour per IP and 100 / hour globally. IP limits apply only when `TRUST_PROXY=1` (right-most `X-Forwarded-For` entry). Live buckets are never evicted; if the store is full, new keys are refused (fail closed). Unknown-email logins still run a bcrypt compare so response timing does not reveal registered emails.
8. **Logging:** Prisma query logging is off unless `PRISMA_LOG_QUERIES=1`.
8a. **Hardening from the independent security review:** every stored original is re-encoded, so EXIF metadata (incl. GPS) is stripped; the selfie analysis has the same 40MP limit and format allow-list (invalid images get 422); `lat`/`lon` are range-checked in outfit generation; the Open-Meteo fetch has a 5 s timeout; image files are deleted if the DB write fails after upload.

## Data, tests, infrastructure

9. **Database:** SQLite to PostgreSQL 16. Initial migration `prisma/migrations/20261004000000_init`. JSON is still stored as TEXT (jsonb/arrays is a follow-up). The `db:push --accept-data-loss` script was removed.
10. **Tests:** Vitest (27 tests), with regression tests for outfit save, auth/JWT secrets and rate limit, private media / upload validation / file deletion, stylist-engine input, and the hardening items above.
11. **Infra:** `apps/web/Dockerfile` (multi-stage, non-root, healthcheck); `GET /api/health` (DB check); `docker-compose.yml` (postgres, one-shot migrate, web; uploads volume; ports bound to 127.0.0.1); `.env.example`; CI in `.github/workflows/ci.yml` (lint, typecheck, tests, build, migration drift check, docker build, gitleaks secret scan).

## Remaining risks / follow-ups

Security and auth
- No refresh-token endpoint; users are logged out after 15 minutes.
- Tokens are stored in localStorage.
- Rate limiter is per process (not shared across instances).
- Signed media URLs are bearer URLs until expiry.
- No request body size limit before multipart parsing, no per-user upload quota, no rate limit on LLM endpoints.
- Free-text/array inputs lack `.max()` limits; weather cache rows are never purged.
- No security headers (CSP, frame-ancestors) on app pages; account deletion has no password re-check.
- Registration returns 409 for existing emails (email enumeration).

AI
- AI vision is a mock (category guessed from filename).
- LLM works only via the Z.ai SDK (non-functional outside Z.ai). See `docs/ai/provider-evaluation.md`.

Recommendation engine
- Dress outfits require bottoms; outerwear is treated as a top; accessories unused.
- Season factor duplicates weather.
- Dislikes penalise items, not combinations.
- No hard occasion constraints.

Weather
- Precipitation window uses 00:00-06:00 rather than the next 6 hours.

Product and codebase
- No URL routing; desktop layout pending.
- i18n not wired (Uzbek hard-coded).
- JSON columns still TEXT.
- 13 unused dependencies were removed; `next-intl` kept for planned localization.
