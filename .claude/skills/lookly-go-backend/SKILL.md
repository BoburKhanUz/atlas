---
name: lookly-go-backend
description: Architecture, conventions and pitfalls for the Lookly Go backend in apps/api (HTTP API from the OpenAPI contract, PostgreSQL via pgx and sqlc, River job queue, R2 storage, AI providers). Use for any code, test, migration or configuration change under apps/api, and when porting behaviour from the Next.js API. Do NOT use for Flutter or web UI work.
---

# Lookly Go backend

`apps/api` replaces the Next.js API with the same contract (`docs/api/openapi.json`)
on the same PostgreSQL database. Read `docs/adr/` first; the decisions there are binding.

## Shape

```
apps/api/
  cmd/lookly/            main: `serve`, `worker`, `migrate`, `eval` subcommands
  internal/
    config/              typed config from env; validated at startup, fails closed
    httpapi/             router, middleware, error envelope, generated server interface
    auth/ session/       login, register, refresh rotation, families, consent gate
    wardrobe/ media/     items, uploads, image variants, signed URLs, storage drivers
    outfits/ engine/     outfit engine (pure), generate, saved outfits, feedback
    stylist/ ai/         conversations, provider adapters, prompts, validation, quotas
    weather/ color/      Open-Meteo client and cache, colour profile analysis
    admin/               admin API (role-checked, audited)
    jobs/                River job definitions and workers
    store/               sqlc queries (queries/*.sql) and generated code
    platform/            logging, clock, ids, crypto helpers
  migrations/            SQL migrations (up and down)
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
- A contract change starts in `openapi.json`, then regeneration, then code. The mobile
  client is regenerated in the same change; CI fails if either is stale.
- Error responses always use the envelope `{error, code, details?, requestId}` with the
  codes and HTTP statuses listed in the contract. The Uzbek `error` text comes from one
  table; codes never change meaning.

## Data

- SQL lives in `store/queries/*.sql`; sqlc generates typed code. No string-built SQL.
- Every multi-statement write runs in one transaction with an explicit isolation level;
  lock order matches `docs/architecture/sessions.md` where sessions are involved.
- Migrations are plain SQL with a down file, applied by `lookly migrate`. The first
  migration is the exact current schema; later ones improve it (jsonb, CHECK, indexes,
  database-side ids and timestamps). Never edit an applied migration.
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
- bcrypt reads at most 72 bytes: reject longer passwords explicitly (owner decision).
- Always set timeouts: server read/write/idle, every outbound HTTP client, every DB query.

## Porting from the Next.js API

The inventory of behaviours (endpoints, cookies vs mobile tokens via `X-Atlas-Client`,
quota charge/refund order, idempotency, consent gate) and the known defects not to copy
are in `references/porting.md`. Parity testing is described in
`.claude/skills/lookly-testing/references/parity.md`.

## Done when

- `go vet ./...`, `staticcheck ./...`, `go test -race ./...` pass.
- The touched endpoints pass their contract tests and the relevant Playwright e2e specs
  against the Go server.
- `lookly-security` ran if auth, sessions, uploads, AI, quotas, admin or config changed.
