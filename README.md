# Lookly

Lookly is an AI personal fashion stylist, built Uzbekistan-first. Users photograph their wardrobe, get outfit recommendations based on weather, occasion and personal taste, and chat with a stylist. The product UI is in Uzbek. The repository keeps the internal working name `atlas` (packages, environment variables, cookies).

## Repository layout

```
apps/mobile/           Flutter app (Android + iOS)
apps/api/              Go backend: the API (/api/v1), the job worker, migrations, `lookly eval`
apps/web/              Next.js website: the landing page, the legal pages, the page a reset link
                       opens; the AI evaluation harness (scripts/ai-eval); Dockerfile
docs/api/              The API contract (openapi.json) - the single source of truth
docs/adr/              Architecture decision records
docs/architecture/     Architecture notes and change logs
docs/ai/               AI provider design and evaluation
docs/release/          Release and device test checklists
docs/history/          Archived history (Z.ai worklog)
deploy/                Single-server deployment (Compose overlay, Caddy, backups)
CLAUDE.md, .claude/    Rules and skills for Claude Code, which writes this codebase
GLOSSARY.md            Domain terms
docker-compose.yml     Postgres + one-shot migration + web
.github/workflows/     CI
```

The backend is the Go server in `apps/api` (`docs/adr/0001-go-backend.md`, `docs/architecture/backend.md`, `apps/api/README.md`). It replaced the Next.js API in stage B7; the old API, Prisma and the user web pages (ADR 0012: the product is the mobile app) are in git history at e57764f.

Origin: the source was imported from a Z.ai-generated export in a single clean import. The export's git history, `.env`, SQLite database, user uploads, screenshots and Z.ai runtime/gateway files were deliberately excluded. Only the worklog was kept (`docs/history/zai-worklog.md`).

## Quick start (Docker Compose)

> **Out of date since B7.6:** Compose still starts the removed Next.js API and Prisma.
> B7.7 rewrites it for the Go server (`docs/plan/B7.md`); until then use the local
> development steps below.

```bash
cp .env.example .env
# Generate two different secrets (>= 32 chars) and put them in .env as
# JWT_SECRET and MEDIA_SIGNING_SECRET:
openssl rand -base64 48
# ...and the session encryption key (exactly 32 bytes) as SESSION_ENC_KEY:
openssl rand -base64 32
# Also set POSTGRES_PASSWORD.
# AI: for local use without a paid provider set AI_LLM_PROVIDER=mock,
# AI_VISION_PROVIDER=mock and AI_ALLOW_MOCK_IN_PRODUCTION=1 (the container runs a production build, which
# otherwise refuses mock AI). See docs/ai/provider-architecture.md.
# Phase 5.0: a production build also keeps every AI feature OFF unless switched on, so for
# local mock use set AI_STYLIST_ENABLED=true, AI_VISION_ENABLED=true, AI_OUTFIT_AI_ENABLED=true
# and AI_ROLLOUT_PERCENT=100 (otherwise the stylist answers 503). See docs/ai/rollout.md.
docker compose up --build
```

Open http://localhost:3000 (use `localhost`: session cookies are `Secure` in production mode, which browsers allow on http://localhost only). Compose starts PostgreSQL 16, runs migrations once, then starts the web container (non-root, healthcheck on `/api/health`). Uploads live in a Docker volume. Ports are bound to 127.0.0.1.

## Local development (without Docker)

The API: `apps/api/README.md` (PostgreSQL 16, `lookly migrate`, `lookly serve`, `lookly worker`).
The website, which needs no database or secret:

```bash
cd apps/web
bun install
bun run dev          # http://localhost:3000
```

## Scripts (run in `apps/web`)

| Script | Purpose |
|---|---|
| `dev` | Next.js dev server on port 3000 |
| `build` | Production build (type-checked), standalone output |
| `start` | Run the standalone production server |
| `lint` | ESLint |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest unit tests (`vitest run`) |
| `test:e2e` | The browser suite against Go (see Testing) |
| `test:api-e2e` | The API journeys against Go (see Testing) |
| `test:eval-go` | The AI evaluation through `lookly eval`, offline (see Testing) |
| `openapi:validate` | Validate `docs/api/openapi.json` |
| `brand:check` | The brand assets match their sources |

## Testing

Build the Go binary first: `cd apps/api && CGO_ENABLED=0 go build -trimpath -tags nodynamic -o <path>/lookly ./cmd/lookly`.

- **Go:** `apps/api/README.md` (unit tests, and the integration tests against PostgreSQL 16).
- **Unit (Vitest):** `cd apps/web && bun run test`: the website's pages and helpers, the contract checker, the AI evaluation harness.
- **Browser suite (Playwright):** `cd apps/web && E2E_GO_BINARY=<path>/lookly ./e2e/run-local.sh` recreates a local database (`atlas_e2e`; see the script for host and port variables), runs `lookly migrate`, builds if needed (`FORCE_BUILD=1` to rebuild) and runs Chromium against the website's production build, with the Go server and worker behind a proxy that sends `/api/` to Go: the landing page, the legal pages, the password reset link, the security headers.
- **API journeys:** `E2E_GO_BINARY=<path>/lookly E2E_DATABASE_URL=<migrated database> bun run test:api-e2e`: accounts, wardrobe, outfits, stylist, colour profile, every answer checked against the contract.
- **AI evaluation (offline):** `LOOKLY_BINARY=<path>/lookly bun run test:eval-go`.
- **CI** runs all of the above, the Flutter checks, the Docker builds, workflow lint and a gitleaks secret scan.

## Configuration

See `.env.example`. The server exits at startup if the required secrets are missing or invalid.

| Variable | Description |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Used by Compose to create and connect to Postgres |
| `DATABASE_URL` | Postgres connection string for running outside Docker |
| `JWT_SECRET` | Required. Access-token signing secret, >= 32 chars |
| `ACCESS_TOKEN_TTL_SECONDS` | Access cookie/JWT lifetime (default 900, min 10) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime without use (default 30); every login is capped at 90 days |
| `SESSION_ENC_KEY` | Required. 32 random bytes, base64 (`openssl rand -base64 32`), independent of other secrets. Encrypts the successor refresh token kept for 60 s after a rotation |
| `SESSION_ENC_DECRYPT_KEYS` | Optional, ≤ 2 comma-separated decrypt-only keys for staged rotation of `SESSION_ENC_KEY` |
| `COOKIE_SECURE` | Cookies are `Secure` in production; `0` disables (plain-http testing on a non-localhost host only) |
| `LOG_LEVEL` | `debug` / `info` (default) / `warn` / `error` — JSON logs, sensitive data redacted |
| `MEDIA_SIGNING_SECRET` | Required. HMAC key for signed media URLs, >= 32 chars, distinct |
| `STORAGE_DRIVER` | Only `local` is implemented |
| `STORAGE_LOCAL_DIR` | Upload directory (default `./storage/uploads`) |
| `MEDIA_URL_TTL_SECONDS` | Signed media URL lifetime (default 3600) |
| `PUBLIC_BASE_URL` | Optional. Origin for absolute image URLs (mobile), e.g. `https://api.atlas.example`; https in production; never derived from the Host header |
| `WEATHER_PROVIDER` | `open-meteo` (default) or `mock`. Verify Open-Meteo's terms before commercial launch |
| `AI_LLM_PROVIDER` | Stylist chat and outfit explanation: `mock` (development default), `gemini` or `openai`. Production refuses `mock` and a real provider without key or model. See `docs/ai/provider-architecture.md` and `docs/ai/stylist-evaluation.md` |
| `AI_LLM_MODEL` | Model id for `gemini`/`openai` (required; there is no built-in choice) |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | Server-side key of the selected provider. Never in the mobile app or in git |
| `AI_LLM_TIMEOUT_MS` | Per-attempt AI timeout, 1000–55000 ms (default 25000) |
| `AI_VISION_PROVIDER` | Clothing analysis: `mock` (development default), `gemini` or `openai`. Production must set it. See `docs/ai/vision-evaluation.md` |
| `AI_VISION_MODEL` | Model id for a real vision provider (required; no built-in choice) |
| `AI_VISION_TIMEOUT_MS` | Per-attempt vision timeout, 1000–55000 ms (default 15000) |
| `AI_VISION_MAX_SIDE` | Longest side sent to the provider, 256–2048 px (default 1024) |
| `AI_VISION_RESOLUTION`, `AI_VISION_GEMINI_THINKING_LEVEL` | Gemini `mediaResolution` (default `high`) and thinking level (default `low`; `none` sends none) |
| `AI_VISION_DETAIL` | OpenAI image detail `low`/`high`/`auto` (default `high`) |
| `AI_ALLOW_MOCK_IN_PRODUCTION` | `1` acknowledges mock AI in a production build (local Docker, e2e). Not needed, and not to be set, when both roles use real providers |
| `TRUST_PROXY` | `1` only behind a proxy that overwrites `X-Forwarded-For`; enables per-IP rate limits |
| `PRISMA_LOG_QUERIES` | `1` logs SQL (may contain user data; debugging only) |

## Security notes

- Never commit `.env`, databases or user photos. Secrets must be distinct, >= 32 chars; old default secrets are rejected. JWTs are verified as HS256 only.
- Uploads are private (not under `public/`) and served through HMAC-signed, expiring URLs. These are bearer URLs until they expire. Each upload is stored as a metadata-free master (never served), a 1600 px display WebP (`url`) and a 400 px thumbnail WebP; HEIC must be converted by the client (415). `Idempotency-Key` makes upload retries safe. See `docs/architecture/media.md`.
- Sessions: a 15-minute access JWT and an opaque refresh token stored only as a SHA-256 hash, rotated on every refresh, grouped per login into a session family with a 90-day absolute limit. A rotated token presented again within 60 s gets the same new token (concurrent or retried requests); later, it revokes that family. The web app keeps both tokens in HttpOnly, SameSite=Lax cookies; the mobile app (`X-Atlas-Client: mobile`) receives them in JSON and uses `Authorization: Bearer`. Cross-origin state-changing requests with session cookies are rejected (403). See `docs/architecture/sessions.md`.
- Auth endpoints are rate limited in memory, per process.
- Deleting an item removes its files; deleting an account removes all its data and its storage directory.
- This repo is private during development. See the known risks in `docs/architecture/phase-1-changes.md`.

## Documentation

- [Phase 1 changes and remaining risks](docs/architecture/phase-1-changes.md)
- [Phase 2 changes (app foundation)](docs/architecture/phase-2-changes.md)
- [AI provider design and evaluation proposal](docs/ai/provider-evaluation.md)
- [Z.ai worklog (history)](docs/history/zai-worklog.md)
