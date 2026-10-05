# ATLAS

ATLAS is an AI personal fashion stylist, built Uzbekistan-first. Users photograph their wardrobe, get outfit recommendations based on weather, occasion and personal taste, and chat with a stylist. The current MVP is a mobile-first Next.js application; the product UI is in Uzbek.

## Repository layout

```
apps/web/              Next.js app (UI, API routes under /api/v1, Prisma schema + migrations, tests, Dockerfile)
docs/architecture/     Architecture notes and change logs
docs/ai/               AI provider design and evaluation proposal
docs/history/          Archived history (Z.ai worklog)
docker-compose.yml     Postgres + one-shot migration + web
.env.example           Environment template
.github/workflows/     CI
```

Origin: the source was imported from a Z.ai-generated export in a single clean import. The export's git history, `.env`, SQLite database, user uploads, screenshots and Z.ai runtime/gateway files were deliberately excluded. Only the worklog was kept (`docs/history/zai-worklog.md`).

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Generate two different secrets (>= 32 chars) and put them in .env as
# JWT_SECRET and MEDIA_SIGNING_SECRET:
openssl rand -base64 48
# Also set POSTGRES_PASSWORD.
docker compose up --build
```

Open http://localhost:3000 (use `localhost`: session cookies are `Secure` in production mode, which browsers allow on http://localhost only). Compose starts PostgreSQL 16, runs migrations once, then starts the web container (non-root, healthcheck on `/api/health`). Uploads live in a Docker volume. Ports are bound to 127.0.0.1.

## Local development (without Docker)

1. Run a PostgreSQL 16 instance and set `DATABASE_URL` plus the two secrets in `apps/web/.env` (see `.env.example`).
2. Then:

```bash
cd apps/web
bun install
bun run db:migrate:deploy
bun run dev          # http://localhost:3000
```

## Scripts (run in `apps/web`)

| Script | Purpose |
|---|---|
| `dev` | Next.js dev server on port 3000 |
| `build` | `prisma generate` + production build (type-checked) |
| `start` | Run the standalone production server |
| `lint` | ESLint |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest unit/regression tests (`vitest run`) |
| `test:e2e` | Playwright end-to-end tests (see Testing) |
| `db:generate` | Generate Prisma client |
| `db:migrate` | `prisma migrate dev` (create/apply migrations in development) |
| `db:migrate:deploy` | Apply existing migrations (production/CI) |
| `db:reset` | Reset the development database |

## Testing

- **Unit/regression (Vitest):** `cd apps/web && bun run test`. Covers sessions (cookies, refresh rotation, reuse detection, logout, CSRF, proxy), API contract (validation, size limits, error shape), outfit saving, secrets, rate limits, private media and the open-redirect guard. The database is mocked.
- **End-to-end (Playwright):** `cd apps/web && ./e2e/run-local.sh` — recreates a local Postgres database (`atlas_e2e`; see the script for host/port variables), applies migrations, builds if needed (`FORCE_BUILD=1` to rebuild) and runs Chromium tests against the production server: auth, session expiry/refresh, wardrobe, outfits, navigation (Back/Forward/refresh/deep links) and layouts at 375/768/1280 px.
- **CI** runs lint, typecheck, unit tests, build, end-to-end tests, a migration drift check, a Docker build and a gitleaks secret scan.

## Configuration

See `.env.example`. The server exits at startup if the required secrets are missing or invalid.

| Variable | Description |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Used by Compose to create and connect to Postgres |
| `DATABASE_URL` | Postgres connection string for running outside Docker |
| `JWT_SECRET` | Required. Access-token signing secret, >= 32 chars |
| `ACCESS_TOKEN_TTL_SECONDS` | Access cookie/JWT lifetime (default 900, min 10) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh session lifetime (default 30) |
| `COOKIE_SECURE` | Cookies are `Secure` in production; `0` disables (plain-http testing on a non-localhost host only) |
| `LOG_LEVEL` | `debug` / `info` (default) / `warn` / `error` — JSON logs, sensitive data redacted |
| `MEDIA_SIGNING_SECRET` | Required. HMAC key for signed media URLs, >= 32 chars, distinct |
| `STORAGE_DRIVER` | Only `local` is implemented |
| `STORAGE_LOCAL_DIR` | Upload directory (default `./storage/uploads`) |
| `MEDIA_URL_TTL_SECONDS` | Signed media URL lifetime (default 3600) |
| `WEATHER_PROVIDER` | `open-meteo` (default) or `mock`. Verify Open-Meteo's terms before commercial launch |
| `LLM_PROVIDER` | Only the Z.ai SDK provider exists; no provider is selected yet (see `docs/ai/provider-evaluation.md`) |
| `TRUST_PROXY` | `1` only behind a proxy that overwrites `X-Forwarded-For`; enables per-IP rate limits |
| `PRISMA_LOG_QUERIES` | `1` logs SQL (may contain user data; debugging only) |

## Security notes

- Never commit `.env`, databases or user photos. Secrets must be distinct, >= 32 chars; old default secrets are rejected. JWTs are verified as HS256 only.
- Uploads are private (not under `public/`) and served through HMAC-signed, expiring URLs. These are bearer URLs until they expire.
- Sessions use HttpOnly, SameSite=Lax cookies: a 15-minute access JWT and an opaque refresh token stored only as a SHA-256 hash, rotated on every refresh; reuse of a rotated token revokes all of the user's sessions. Cross-origin state-changing requests with session cookies are rejected (403). Bearer tokens remain accepted for future API clients.
- Auth endpoints are rate limited in memory, per process.
- Deleting an item removes its files; deleting an account removes all its data and its storage directory.
- This repo is private during development. See the known risks in `docs/architecture/phase-1-changes.md`.

## Documentation

- [Phase 1 changes and remaining risks](docs/architecture/phase-1-changes.md)
- [Phase 2 changes (app foundation)](docs/architecture/phase-2-changes.md)
- [AI provider design and evaluation proposal](docs/ai/provider-evaluation.md)
- [Z.ai worklog (history)](docs/history/zai-worklog.md)
