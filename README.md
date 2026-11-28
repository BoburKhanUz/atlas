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
docker-compose.yml     PostgreSQL, lookly migrate (once), the API and its worker, the website, Caddy
.github/workflows/     CI
```

The backend is the Go server in `apps/api` (`docs/adr/0001-go-backend.md`, `docs/architecture/backend.md`, `apps/api/README.md`). It replaced the Next.js API in stage B7; the old API, Prisma and the user web pages (ADR 0012: the product is the mobile app) are in git history at e57764f.

Origin: the source was imported from a Z.ai-generated export in a single clean import. The export's git history, `.env`, SQLite database, user uploads, screenshots and Z.ai runtime/gateway files were deliberately excluded. Only the worklog was kept (`docs/history/zai-worklog.md`).

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Fill in POSTGRES_PASSWORD (openssl rand -hex 24), JWT_SECRET and
# MEDIA_SIGNING_SECRET (openssl rand -base64 48, each different) and
# SESSION_ENC_KEY (openssl rand -base64 32). Nothing else is needed locally:
# the AI is the mock and reset e-mails are files in a volume.
docker compose up --build
```

Open http://localhost:3000. Compose starts PostgreSQL 16, runs `lookly migrate` once, then the Go API, its worker, the website and Caddy, which sends `/api/*` to Go and everything else to the website. Images and the reset e-mails live in Docker volumes; Caddy's port and, for local tools, PostgreSQL's are published, on 127.0.0.1 only (a server publishes 80 and 443 alone). `python3 -I -B deploy/check-stack.py` checks a running stack through Caddy (CI runs it on every push). A server adds `deploy/compose.server.yml` for HTTPS: [`docs/deploy/staging.md`](docs/deploy/staging.md).

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

Locally `.env` (from [`.env.example`](.env.example)); on a server `deploy/server.env` (from [`deploy/server.env.example`](deploy/server.env.example)). Both list every variable with what it does. The Go server reads and checks them all when it starts and stops with a message naming any it refuses: a missing or weak secret, an unknown provider, the mock AI or test mail outside development (`apps/api/internal/config`). The website needs no configuration.

## Security notes

- Never commit `.env`, databases or user photos. Secrets must be distinct, >= 32 chars; old default secrets are rejected. JWTs are verified as HS256 only.
- Uploads are private (not under `public/`) and served through HMAC-signed, expiring URLs. These are bearer URLs until they expire. Each upload is stored as a metadata-free master (never served), a 1600 px display WebP (`url`) and a 400 px thumbnail WebP; HEIC must be converted by the client (415). `Idempotency-Key` makes upload retries safe. See `docs/architecture/media.md`.
- Sessions: a 15-minute access JWT and an opaque refresh token stored only as a SHA-256 hash, rotated on every refresh, grouped per login into a session family with a 90-day absolute limit. A rotated token presented again within 60 s gets the same new token (concurrent or retried requests); later, it revokes that family. The mobile app (`X-Atlas-Client: mobile`) receives both tokens in JSON and uses `Authorization: Bearer`; a browser client (the admin panel, W2) keeps them in HttpOnly, SameSite=Lax cookies. Cross-origin state-changing requests with session cookies are rejected (403). See `docs/architecture/sessions.md`.
- Sign-in, registration, password reset and the AI are rate limited in PostgreSQL (shared by every process), per account and, behind Caddy, per client address; the AI also has daily quotas in Tashkent time.
- Deleting an item removes its files; deleting an account removes its data at once and its images through the worker (`docs/architecture/media.md`).
- This repo is private during development. The security reviews of each stage are in `docs/plan/` (the `lookly-security` gate); `docs/architecture/phase-1-changes.md` and `phase-2-changes.md` are the history of the Next.js server.

## Documentation

- [Stages and their reviews](docs/plan/README.md)
- [The Go backend](docs/architecture/backend.md)
- [Phase 1](docs/architecture/phase-1-changes.md) and [Phase 2](docs/architecture/phase-2-changes.md) changes (history: the Next.js server)
- [AI provider design and evaluation proposal](docs/ai/provider-evaluation.md)
- [Z.ai worklog (history)](docs/history/zai-worklog.md)
