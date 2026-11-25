---
name: lookly-go-backend
description: Architecture, conventions and pitfalls for the Lookly Go backend in apps/api (HTTP API from the OpenAPI contract, PostgreSQL via pgx and sqlc, River job queue, R2 storage, AI providers). Use for any code, test, migration or configuration change under apps/api, and when porting behaviour from the Next.js API. Do NOT use for Flutter or web UI work.
---

# Lookly Go backend

`apps/api` replaces the Next.js API with the same contract (`docs/api/openapi.json`)
on the same PostgreSQL database. Read `docs/adr/` first; the decisions there are binding.

## Shape

The Go module and binary are named `lookly`; existing wire names (`atlas_at`,
`X-Atlas-Client`, `ATLAS_*` variables the deployment already uses) stay as they are.

Built so far (B0) and planned:

```
apps/api/
  cmd/lookly/            thin main (signals); the commands live in internal/app
  internal/
    app/                 commands: `serve`, `health` (B0); `worker`, `migrate`, `eval` later
    config/              typed config from env; validated at startup, fails closed
    apierr/              the contract's error codes: status and Uzbek message (one table)
    httpapi/             router, middleware (request id, access log, recovery, body
                         limit), error envelope, Server = the generated interface
    httpapi/contract/    generated from docs/api/openapi.json (never edited by hand)
    contracttest/        test helper: validates responses against the contract
    database/            pgx pool
    health/              database liveness
    store/               sqlc queries (queries/*.sql) and generated code
    maintenance/         scheduled cleanup (sessions, reset links, idempotency, weather)
    jobs/                River client, workers, periodic jobs (schema "river")
    dbtest/              test helper: throwaway databases, catalog snapshot, test clock
    auth/ session/       login, register, refresh rotation, families, consent gate
    wardrobe/ media/     items, uploads, image variants, signed URLs, storage drivers
    outfits/ engine/     outfit engine (pure), generate, saved outfits, feedback
    stylist/ ai/         conversations, provider adapters, prompts, validation, quotas
    weather/ color/      Open-Meteo client and cache, colour profile analysis
    admin/               admin API (role-checked, audited)
    platform/            clock, ids, crypto helpers (when a second package needs them)
  migrations/            goose SQL migrations, embedded; 00001_baseline = Prisma (Up only)
  testdata/              golden vectors, fixture images
```

- One package per domain. A domain package exposes a `Service` with plain Go types; it
  depends on `store` and on interfaces for the outside world (clock, storage, AI, mail).
- Layers: `httpapi` handler → domain service → `store`. A layer calls only the one below.
  Handlers decode, call one service method, encode. No SQL or business rule in handlers.
- Domain packages never import each other's internals; shared types live in the package
  that owns them and are passed by value.

## Contract first

- The server interface and request/response types are generated from
  `docs/api/openapi.json` (oapi-codegen, strict server). Never hand-write a route.
  The document is OpenAPI 3.1 and is used as is (ADR 0008): only implemented
  operations are generated (`include-operation-ids`), and contract tests validate
  responses with `internal/contracttest`.
- **Until B7 the document is generated** from `apps/web/src/server/openapi/registry.ts`:
  a contract change starts there, then `bun run openapi:write`, then
  `apps/mobile/tool/openapi/generate_api.sh`, then the Go code. Never edit the JSON by
  hand before B7 (CI's `openapi:check` rejects it). From B7 the JSON is hand-owned
  (ADR 0003).
- Error responses always use the envelope `{error, code, details?, requestId}` with the
  codes and HTTP statuses listed in the contract. The Uzbek `error` text comes from one
  table; codes never change meaning.

## Data

- SQL lives in `store/queries/*.sql`; sqlc generates typed code. No string-built SQL.
- Every multi-statement write runs in one transaction with an explicit isolation level;
  lock order matches `docs/architecture/sessions.md` where sessions are involved.
- Migrations follow ADR 0007: until B7 Prisma alone changes the shared schema and the
  Go service runs no migrations against it. The Go baseline equals the Prisma schema, is
  recorded as applied rather than run, and has no down file. Improvement migrations
  (jsonb, CHECK, indexes, database-side ids and timestamps) start at B7. Never edit an
  applied migration; never run a down migration in production without a backup and the
  owner's approval.
- Every list endpoint is paginated with a bounded page size; no unbounded `SELECT`.
- Times are stored and compared in UTC; "day" for quotas means the Asia/Tashkent day.

## Background work

- Anything that can take more than about a second (AI analysis, image variants, mail,
  cleanup) runs as a River job in `lookly worker`, not inside the request.
- Jobs are idempotent and retry with backoff; a job that gives up records why, and the
  user sees a clear state, never an endless spinner.
- Scheduled cleanup removes expired sessions, reset tokens, weather cache rows and
  orphaned files.

## Errors and logging

- Return errors with context (`fmt.Errorf("load item %s: %w", id, err)`); handle them
  once, at the edge. Never `_ =` an error that can fail. Never `panic` for control flow.
- Log with `slog` as JSON: request id, user id (not email), route, duration, outcome.
  Never log tokens, passwords, cookies, prompts, AI outputs or image bytes.
- Map internal errors to contract codes in one place; unknown errors become 500 with a
  request id, and the cause is logged.

## Configuration and startup

- All configuration comes from environment variables into a typed struct, validated at
  startup. A missing or invalid secret, an unknown provider or storage driver, or mock AI
  in production stops the process with a clear message.
- No default secrets, no "development" fallbacks that can reach production.

## Go pitfalls to check in every change

- `json.Decoder` with `DisallowUnknownFields` where the contract forbids extra fields;
  remember Go matches JSON keys case-insensitively.
- Typed nil inside an interface is not `nil`.
- Goroutines always have a way to stop (context); no fire-and-forget without tracking.
- Integer sizes: check overflow in size and dimension arithmetic on untrusted input.
- Compare secrets with `crypto/subtle.ConstantTimeCompare`.
- bcrypt reads at most 72 bytes: reject longer passwords when a password is set or
  changed (owner decision), never at login (existing hashes were made from the first 72
  bytes). Re-hash cost-10 hashes at cost 12 after a successful login.
- Always set timeouts: server read/write/idle, every outbound HTTP client, every DB query.

## AI prompts and paid calls

- Port prompts byte-for-byte with their version constants (`STYLIST_PROMPT_VERSION`,
  `OUTFIT_PROMPT_VERSION`, `VISION_ANALYSIS_VERSION`). Any wording change needs the
  owner's approval and a version bump (CLAUDE.md rule 6).
- Tests and CI use mock providers only. The `eval` subcommand and anything else that
  calls a real provider runs only with the owner's approval and an explicit call cap.

## Porting from the Next.js API

The inventory of behaviours (endpoints, cookies vs mobile tokens via `X-Atlas-Client`,
quota charge/refund order, idempotency, consent gate) and the known defects not to copy
are in `references/porting.md`. Parity testing is described in
`.claude/skills/lookly-testing/references/parity.md`.

## Done when

- `scripts/generate.sh --check`, `go vet ./...`, staticcheck, `go test -race -tags integration ./...` and govulncheck pass (exact commands: `apps/api/README.md`).
- The touched endpoints pass their contract tests and the relevant Playwright e2e specs
  against the Go server.
- `lookly-security` ran if auth, sessions, uploads, AI, quotas, admin or config changed.
