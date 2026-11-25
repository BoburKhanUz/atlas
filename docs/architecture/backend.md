# Go backend (`apps/api`)

The Go service replaces the Next.js API with the same contract (`docs/api/openapi.json`)
on the same PostgreSQL database (ADR 0001, ADR 0002). Until the cutover (B7) nothing
routes traffic to it; each stage adds endpoints behind tests. Rules for working in it:
`.claude/skills/lookly-go-backend/SKILL.md`. Stage plan: `docs/plan/README.md`.

## Request path

```
client ─► Wrap (middleware) ─► routed (404 for unknown routes) ─► generated router
          request id           route pattern for the log            │
          access log                                                ▼
          panic → 500                              generated strict handler (decodes)
          64 KB body limit                                          │
                                                                    ▼
                                         httpapi.Server method ─► domain service ─► store
                                                    │
                     apierr.Error / any error ◄─────┘
                                │
                                ▼
                  WriteError: the contract's error envelope
```

- **Generated code** (`internal/httpapi/contract`): the server interface and types come
  from the contract with oapi-codegen (ADR 0008). Only implemented operations are
  generated; `TestEveryContractOperationIsGeneratedOrListedAsNotYetImplemented` lists
  the rest. `scripts/generate.sh --check` fails CI when the generated file is stale.
- **Handlers** (`internal/httpapi/server.go`): one method per operation. Each calls one
  service method and encodes the answer. No SQL and no business rules.
- **Errors** (`internal/apierr`): the 31 contract codes with their status and Uzbek
  message in one table. Services return `*apierr.Error`; anything else becomes 500
  `INTERNAL`, logged with its cause and the request id, and never sent to the client.
  The generator's own decode errors match the Next.js API, which parses then validates
  with zod:
  - a parameter or header of the wrong form, or a JSON value of the wrong type, is
    `VALIDATION_ERROR` naming the field;
  - an empty body is `VALIDATION_ERROR` (Node reads it as `{}`);
  - malformed JSON is `BAD_REQUEST`, and a body over the limit is `PAYLOAD_TOO_LARGE`.

  Field-level Uzbek messages come from each service's own validation (B2 onward). The
  first operation with inputs adds tests of these through the real router: health has no
  inputs, so B0 tests the mapping directly.
- If writing a response fails after it started (the client left), nothing is added to
  it; this is logged as a warning, not as an internal error. Error responses carry
  `Cache-Control: no-store`.
- Not everything reaches the router: net/http answers some malformed requests itself
  (a bad `Content-Length`: plain 400; headers over 16 KB: 431), and ServeMux redirects
  unclean paths (`//api/health`: 307). The Next.js server has similar edges.
- **Request id**: a single client `X-Request-Id` matching `[A-Za-z0-9-]{8,64}` is kept,
  otherwise (missing, malformed or sent more than once, as the Next.js API) a random UUID
  is used. It is in the response header, the envelope and every request's log lines.
- **Logs**: JSON on stdout (`log/slog`). There is one `request` line per request with the
  method, the route pattern (not the path, which can hold media keys), status, bytes and
  duration. Query strings, headers and bodies are never logged. A panic is logged with
  its type and stack, not its value.

## Configuration

`internal/config` reads the environment once at startup and fails closed: every invalid
or missing value is reported, naming the variable, and the process exits with code 2
before listening. Values that hold credentials are never printed.

| Variable | Default | Rule |
|---|---|---|
| `LOOKLY_ENV` | none (required) | `production`, `staging`, `development` or `test` |
| `DATABASE_URL` | none (required) | `postgres://` or `postgresql://` URL with host and database (shared with the Next.js server); in production `sslmode` must be set to `disable`, `require`, `verify-ca` or `verify-full` (the driver's default, `prefer`, falls back to plain text silently) |
| `LOOKLY_HTTP_ADDR` | `:8080` | `host:port` or `:port` |
| `LOOKLY_DB_MAX_CONNS` | `10` | 1–100 |
| `LOOKLY_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`; `debug` is refused in production |
| `LOOKLY_SHUTDOWN_GRACE` | `20s` | 1 s – 2 min |

Later stages add their settings (session keys, media secret, AI, mail) to the same check.

The PostgreSQL driver (pgx) also reads `PG*` variables (`PGPASSWORD`, `PGSSLMODE`, …),
`~/.pgpass` and the service file for anything the URL leaves out. The URL is required to
name the host and database, and in production `sslmode`. The container sets no `PG*`
variables; keep it that way.

## Process

- `lookly serve` validates the configuration, opens the pgx pool (lazily: the server
  starts while the database is down, and health reports it), and serves with these
  limits: header 5 s, read 30 s, write 60 s, idle 120 s, headers ≤ 16 KB. SIGINT or
  SIGTERM stops accepting connections and lets running requests finish within
  `LOOKLY_SHUTDOWN_GRACE`. After it, the remaining connections are closed, which cancels
  their requests. A second signal exits at once (130). Exit codes: 0 clean, 1 runtime
  failure or requests cut off, 2 usage or configuration error.
- `lookly worker` runs the background jobs (River) with the same configuration; on a
  signal it stops River within the grace period and cancels jobs still running after
  it.
- `lookly migrate river` creates River's schema and tables (idempotent). Against a
  shared or production database only with the owner's approval of the deploy.
- `lookly health` requests the local `/api/health` and exits 0 only on 200. The image is
  distroless (no shell or curl), so this is its Docker `HEALTHCHECK`.
- `GET /api/health` pings the database within 2 s: 200 `{status: ok, database: ok,
  version}` or 503 `{status: degraded, database: unreachable, version}`, `Cache-Control:
  no-store`. This is the Next.js behaviour.
- The version is stamped at build time (`-ldflags -X lookly/internal/app.version=…`,
  the image's `--build-arg VERSION`); `dev` otherwise. The deployment must pass it (the
  Next.js server read `APP_VERSION`).

## Deployment notes for B7

- goose keeps its version table (`goose_db_version`) in `public`. Decide at the cutover
  whether it stays there while a rollback to Prisma is still possible, or moves to its
  own schema.
- `lookly worker` has no health check of its own: if River loses the database, it logs
  errors but keeps running. Monitor its logs (or add a probe) when it is deployed.

- Docker stops a container after 10 s by default; `LOOKLY_SHUTDOWN_GRACE` is 20 s. The
  service's compose entry needs `stop_grace_period` of at least the grace plus 5 s
  (25 s), or the grace period never applies.
- `DATABASE_URL` is shared with Prisma. Prisma-only URL options (`schema`,
  `connection_limit`, `pgbouncer`) pass this check, but PostgreSQL refuses them when pgx
  forwards them. Health then shows 503. Check the production URL at the cutover.
- The runtime base image is pinned by digest. The build image
  (`golang:1.26.11-bookworm`) is pinned by tag only: Docker Hub rate-limited the digest
  lookup in the B0 session. Pin it by digest before the first production image.

## Database

Until B7, Prisma owns the `public` schema and its migrations (ADR 0007). The Go service
reads and writes data but changes no schema there.

- **Migrations** (`apps/api/migrations`, goose v3, embedded in the binary):
  - `00001_baseline.sql` equals the Prisma schema up to
    `20261017010000_password_reset`, including the two `SystemMarker` rows.
  - `scripts/make-baseline.sh` produces it from the Prisma migrations; it is never
    hand-edited and has Up only.
  - Until B7 the migrations run in test databases only. A Prisma migration added before
    then means rebuilding the baseline. At B7 the baseline is recorded as applied in
    production (not run) and Go takes over the schema.
- **Schema equality**: `migrations/schema_integration_test.go` applies Prisma's
  migrations and the Go migrations to two fresh databases and compares their catalogs:
  - tables and columns (type, nullability, default);
  - constraints, indexes, functions, triggers and types;
  - the marker rows.

  Any difference fails CI and names the object.
- **Queries** (`internal/store`, sqlc v1.31.1): SQL in `internal/store/queries/*.sql`,
  typed Go generated over the migrations and committed (`scripts/generate.sh`).
  Timestamps are Prisma's `timestamp(3)` without time zone holding UTC: `time.Time` in
  UTC. Nullable columns are pointers. Times that decide security or retention are
  compared with the database clock `atlas_now()`, as the Node session protocol does.
- **Jobs** (`internal/jobs`, River v0.51.2): tables in the schema `river`, which Prisma
  does not manage, so it neither shows them as drift nor drops them. `lookly migrate
  river` creates them. `lookly worker` runs the queue; it refuses to start without the
  tables or when the database cannot be reached (it says which, and gives the server's
  SQLSTATE, never the user, database or host). Periodic jobs run on the elected leader
  only.
- **Cleanup** (`internal/maintenance`, a periodic job: hourly and at every worker
  start; at most 3 attempts per run). It runs as one read-committed transaction with
  `lock_timeout` 5 s. Its locking follows the session protocol, so a refresh or a
  revocation racing it cannot deadlock (both cases tested):
  - it locks the dead families first, in id order, before any of their sessions;
  - session rows of live families (stale ciphertexts, old rotated rows) are taken with
    `SKIP LOCKED`: a row someone else holds is left to them or to the next run.

  Runs are not serialised: a job left "running" by a killed worker never blocks the
  next one, and several cleanups at once are safe (tested). It applies the manual Node
  script's rules
  (`docs/architecture/sessions.md`, Operations):
  - successor ciphertexts: cleared after 60 s;
  - rotated sessions and families dead for 30 days: deleted;
  - reset links: deleted once expired.

  It also deletes expired idempotency keys and weather cache rows. Consent records and
  quota history are never deleted. Each run logs its counts (`cleanup done`). A busy
  table makes the run give up and retry, instead of blocking sign-ins. Orphaned media
  files wait for the storage driver (B4).

## Tests and CI

- Handlers are tested over `httptest` through the real router and middleware. Every
  response body is validated against the contract (`internal/contracttest`: JSON Schema
  2020-12, ECMAScript regex; ADR 0008).
- Integration tests carry the build tag `integration` and need `LOOKLY_TEST_DATABASE_URL`
  (a PostgreSQL 16). They fail, never skip, when it is missing.
- CI job `api` does the following:
  - checks the generated code, `gofmt`, `go vet`, staticcheck v0.8.2 and govulncheck v1.9.0;
  - runs `go test -race -tags integration ./...` against a PostgreSQL 16 service;
  - builds the binary.

  The `docker` job builds the image.
