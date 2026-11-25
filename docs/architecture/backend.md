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
  The generator's own decode errors become `BAD_REQUEST`, `VALIDATION_ERROR` (naming
  the parameter) or `PAYLOAD_TOO_LARGE`.
- **Request id**: a client `X-Request-Id` matching `[A-Za-z0-9-]{8,64}` is kept,
  otherwise a random UUID is used. It is in the response header, the envelope and every
  log line.
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
| `DATABASE_URL` | none (required) | `postgres://` or `postgresql://` URL with host and database (shared with the Next.js server) |
| `LOOKLY_HTTP_ADDR` | `:8080` | `host:port` or `:port` |
| `LOOKLY_DB_MAX_CONNS` | `10` | 1–100 |
| `LOOKLY_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`; `debug` is refused in production |
| `LOOKLY_SHUTDOWN_GRACE` | `20s` | 1 s – 2 min |

Later stages add their settings (session keys, media secret, AI, mail) to the same check.

## Process

- `lookly serve` validates the configuration, opens the pgx pool (lazily: the server
  starts while the database is down, and health reports it), and serves with these
  limits: header 5 s, read 30 s, write 60 s, idle 120 s, headers ≤ 16 KB. SIGINT or
  SIGTERM stops accepting connections and lets running requests finish within
  `LOOKLY_SHUTDOWN_GRACE`. Exit codes: 0 clean, 1 runtime failure, 2 usage or
  configuration error.
- `lookly health` requests the local `/api/health` and exits 0 only on 200. The image is
  distroless (no shell or curl), so this is its Docker `HEALTHCHECK`.
- `GET /api/health` pings the database within 2 s: 200 `{status: ok, database: ok,
  version}` or 503 `{status: degraded, database: unreachable, version}`, `Cache-Control:
  no-store`. This is the Next.js behaviour.
- The version is stamped at build time (`-ldflags -X lookly/internal/app.version=…`);
  `dev` otherwise.

## Database

Until B7, Prisma owns the schema and its migrations (ADR 0007). The Go service runs no
migrations; in B0 it only pings. The data layer (sqlc, River) arrives in B1.

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
