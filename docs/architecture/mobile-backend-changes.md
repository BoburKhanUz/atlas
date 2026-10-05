# Mobile-ready backend (after Phase 2)

ATLAS is primarily a native mobile app; the Next.js app is the backend plus a
web reference client. This change set makes the backend ready for the mobile
client without changing the product scope. Details: `sessions.md`,
`media.md`, `docs/api/README.md`, `docs/database/cutover.md`.

## Sessions
- Session families: one per login, `clientType` web | mobile, 90-day absolute
  limit; refresh tokens rotate within the family; access tokens 15 min, capped
  at the family limit.
- Family-first locking protocol on PostgreSQL (`atlas_now()` clock): a token
  rotated ≤ 60 s ago returns the same new token (encrypted successor,
  `SESSION_ENC_KEY`), later it revokes only that family. New codes:
  `INVALID_TOKEN`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_REUSED`,
  `SESSION_RACE`, `CLIENT_MISMATCH` (401), `SESSION_BUSY` (503).
- Mobile mode: `X-Atlas-Client: mobile` → tokens in JSON bodies, refresh and
  logout with `{ refreshToken }`, `Authorization: Bearer` elsewhere.
- Web client recovery (race / busy / network rules) and the shared recovery
  vectors for Flutter.
- Stop-the-world cutover migration adopting every existing session, with a
  bounded transition for old Phase 2 sessions (at least 30 days after the
  cutover, never more than 90); rollback scripts tested against the real
  Phase 2 build.

## Media
- Variants: metadata-free master (never served), 1600 px WebP display (`url`),
  400 px WebP thumbnail; dimension limits; HEIC → 415 (clients convert).
- `Idempotency-Key` on uploads; absolute URLs from `PUBLIC_BASE_URL`.
- Scripts: storage sweep, display backfill (dry run by default).

## API contract
- OpenAPI 3.1 generated from the Zod schemas the routes use
  (`docs/api/openapi.json`, `GET /api/v1/openapi.json`), drift and contract
  tests, non-blocking Dart client job in CI.

## Fixes found along the way
- Access cookie Max-Age off by one second (rounded up now).
- Upload screen could stay on "Tahlil qilinmoqda…" after a fast upload
  (AnimatePresence `mode="wait"` race) — exit animations removed.
- Docker build would fail on test-only config files — excluded from the build
  context.

## Tests
Unit (Vitest), integration on a real PostgreSQL (`bun run test:integration`,
`ATLAS_ITEST_PG*`), rollback against the Phase 2 build (`PHASE2_DIR`),
Playwright with an OpenAPI response check on every API call.
