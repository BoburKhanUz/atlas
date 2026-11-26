# Go backend (`apps/api`)

The Go service replaces the Next.js API with the same contract (`docs/api/openapi.json`)
on the same PostgreSQL database (ADR 0001, ADR 0002). Until the cutover (B7) nothing
routes traffic to it; each stage adds endpoints behind tests. Rules for working in it:
`.claude/skills/lookly-go-backend/SKILL.md`. Stage plan: `docs/plan/README.md`.

## Request path

```
client ─► Wrap (middleware) ─► routed (404 for unknown routes) ─► generated router
          request id           route pattern for the log            │ header and path parameters
          30 s time limit                                           │
          access log                                                ▼
          panic → 500                                     gate (per route, in this order)
          64 KB body limit                                 1. cross-site request guard → 403
                                                           2. access token + live session → 401
                                                           3. consent to the legal texts → 403
                                                           4. request body rule → 400
                                                                    │
                                                                    ▼
                                                   generated strict handler (decodes)
                                                                    │
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

  From B2 on, request bodies are judged by the gate's body rules before the generated
  decoder reads them (see *The gate*), with the Next.js validator's own messages; the
  mapping above remains for parameters and for operations without a body rule.
- If writing a response fails after it started (the client left), nothing is added to
  it; this is logged as a warning, not as an internal error.
- **Caching headers**: only health and answers with tokens in the body (mobile mode)
  say `Cache-Control: no-store`. Nothing else sets a caching header, as the Next.js API
  sets none. The reason is a browser behaviour the e2e suite found in Go mode: Chromium
  keeps a `no-store` answer pending for as long as the page has not read its body, and
  the web client does not read every body (a successful refresh, a sign-out).
- Not everything reaches the router: net/http answers some malformed requests itself
  (a bad `Content-Length`: plain 400; headers over 16 KB: 431), and ServeMux redirects
  unclean paths (`//api/health`: 307). The Next.js server has similar edges.
- **Time limit**: every request's context ends after 30 s (`RequestTimeout`), which
  cancels its database calls and its wait for a pooled connection, so a stalled database
  cannot hold requests until their clients give up. The session transaction and the
  rate limiter have their own, shorter lock and statement timeouts inside it.
- **Request id**: a single client `X-Request-Id` matching `[A-Za-z0-9-]{8,64}` is kept,
  otherwise (missing, malformed or sent more than once, as the Next.js API) a random UUID
  is used. It is in the response header, the envelope and every request's log lines.
- **Logs**: JSON on stdout (`log/slog`). There is one `request` line per request with the
  method, the route pattern (not the path, which can hold media keys), status, bytes and
  duration, and the caller's user id once the gate knows it (never the email). Query
  strings, headers and bodies are never logged. A panic is logged with
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
| `JWT_SECRET` | none (required) | at least 32 characters; not one of the known shipped defaults; no white space at its ends (it is used exactly as given, as the Next.js server uses it) |
| `SESSION_ENC_KEY` | none (required) | standard base64 of exactly 32 bytes (`openssl rand -base64 32`); neither the text nor the bytes of `JWT_SECRET` or `MEDIA_SIGNING_SECRET` |
| `SESSION_ENC_DECRYPT_KEYS` | none | up to 2 older keys, comma-separated, same rules; they decrypt only (staged key rotation) |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | whole number, 10 – 86 400 |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | whole number, 1 – 365 |
| `COOKIE_SECURE` | on in production and staging, off in development and test | `0` or `1`; `0` is refused in production |
| `TRUST_PROXY` | `0` | `0` or `1`; `1` only behind the reverse proxy that sets the forwarding headers |

The session variables are shared with the Next.js server and follow its rules, with two
differences: Go refuses a value out of range or malformed, where the Next.js server
silently used the default or the nearest limit; and Go refuses `COOKIE_SECURE=0` in
production. `serve`, `worker` and `migrate river` validate the whole configuration, so
all three need the secrets; `health` reads only `LOOKLY_HTTP_ADDR`. In production
without `TRUST_PROXY=1` the server logs a warning at start: client addresses are then
unknown, so sign-in is limited per account only and registration shares one limit.

Later stages add their settings (media secret, AI, mail) to the same check.

The PostgreSQL driver (pgx) also reads `PG*` variables (`PGPASSWORD`, `PGSSLMODE`, …),
`~/.pgpass` and the service file for anything the URL leaves out. The URL is required to
name the host and database, and in production `sslmode`. The container sets no `PG*`
variables; keep it that way.

## The gate

Every route passes `httpapi.Gate` before its handler (`internal/httpapi/gate.go`). Its
table names the routes that are public, the one where a session is optional (sign-out)
and the ones served although the user's consent is out of date. **A route that is not in
the table is closed**: it needs a session and a current consent. A test compares the
table with the contract's `security` fields for every route served.

1. **Cross-site request guard.** A state-changing request without an `Authorization`
   header whose `Origin` names another host is refused with `FORBIDDEN`, before anything
   else happens. Browsers send `Origin` on every cross-site write, form posts included,
   and another site's page cannot add an `Authorization` header. The guard does not look
   at the cookies: they are `SameSite=Lax`, so a browser never sends them on a cross-site
   write, and what such a write could still do is set them (a posted sign-in form that
   leaves the browser signed in to the attacker's account) or clear them. The Next.js API
   guarded only requests that carried a cookie, so it did not stop that; Go does.
   `Origin: null` is another host; no `Origin` passes (the mobile app sends none). Behind
   the trusted proxy (`TRUST_PROXY=1`) the first `X-Forwarded-Host` is the host.
2. **Who is calling.** An `Authorization` header, when present, is the only credential
   considered, even when it is empty or invalid: there is no fallback to the cookie.
   Otherwise the `atlas_at` cookie. The token must be ours, unexpired, and name a session
   that **still stands**, looked up on every request: its family is not revoked, and the
   session is live or was only rotated. So a sign-out, a detected reuse, a password
   reset or an account deletion takes effect at once (the Next.js API kept accepting the
   token until it expired, up to 15 minutes). A rotated session's token stays good until
   it expires, so requests in flight during a refresh are not refused.
3. **Consent.** Unless the route is exempt, none of the user's consents being at least
   the minimum version answers `CONSENT_REQUIRED` (`internal/legal`; the versions and
   their ordering equal the TypeScript ones, by test).
4. **Request body.** For routes with a body rule (`internal/httpapi/bodies.go`) the raw
   body is judged as the Next.js API's schema judged it, and the generated decoder then
   reads its canonical form: only the known members, normalised. The same members are
   reported, in the same order, with the same Uzbek messages; 271 recorded answers of
   the Next.js validator pin this. Refresh and sign-out read a body in mobile mode only;
   in web mode the cookies carry everything and a body is not read at all.

The handler then finds the caller (`identityFrom`) and the request (`requestFrom`) in
its context. Cookies are parsed as Next parses them (of several with one name the last
counts, quotes are kept, values are percent-decoded), not as `net/http` does.

## Accounts

`internal/accounts` is registration, sign-in and "who am I", on the session protocol
and the rate limiter.

- **Registration** checks the limit, then creates the user, the profile, the preferences
  and the consent record in one transaction, then starts a session. Two registrations of
  one email at once give one `201` and `CONFLICT` for the rest, never a partial account
  (tested with four at once). Ids and times are written by Go until B7: ids as Prisma
  shaped them, times from the database clock in UTC.
- **Sign-in** counts the attempt, looks the user up, and compares the password. Every
  failed attempt costs one comparison at the current cost and one at the cost of the old
  server's hashes: the account's own hash is one of the two and a decoy the other, and
  for an unknown email both are decoys. So the answer and the time it takes say neither
  whether the email is registered nor how old its hash is. A success gives the attempt back to the
  limiter and, if the stored hash is weaker than the current cost, replaces it (only if
  it is still the hash that was verified). A password over 72 bytes from the old server
  keeps signing in and keeps its hash.
- **Limits**: sign-in 10 failures per account and 50 per address in 15 minutes;
  registration 10 attempts per address per hour, or one shared bucket of 100 per hour
  when the address is not known (no trusted proxy). An IPv6 address is counted by its
  /64 network. `RATE_LIMITED` carries `Retry-After`.
- **Answers** (`internal/httpapi/server.go`): web mode sets the two HttpOnly cookies
  (`Path=/`, `SameSite=Lax`, `Secure` by configuration, `Max-Age` counted from the
  database time of issue and rounded up) and sends `{user}`; mobile mode sends the
  tokens and their expiries in the body and no cookies. Times are written as JavaScript
  writes them (milliseconds, `Z`). A web refresh that ends the session for good clears
  the cookies; `SESSION_RACE` and `SESSION_BUSY` (with `Retry-After: 1`) keep them.

## Tokens, passwords and session encryption

`internal/auth` and `internal/session` hold the pure parts of sign-in, ported from the
TypeScript code with exact parity: both servers must accept each other's sessions until
the cutover (`docs/plan/B2.md`).

- **Golden vectors** (`apps/api/testdata/golden/auth.json`) are inputs and outputs
  recorded from the real TypeScript functions by `apps/web/scripts/golden-auth.ts`
  (`bun scripts/golden-auth.ts ../api/testdata/golden/auth.json` in `apps/web`). The Go
  tests load every record. A mismatch is investigated, never regenerated away. The
  vectors use fixed test secrets that exist nowhere else; `.gitleaks.toml` exempts that
  directory, and only it, from the secret scan.
- **Access token**: JWT, HS256, issuer `ai-fashion-stylist`, claims `sub`, `email`,
  `sid`. Go signs byte for byte what the TypeScript signer (jose) signs. The verifier is
  hand-written on the standard library: it reads member names exactly (a general JSON
  decoder would take `"Sub"` for `"sub"`), accepts only `HS256`, and refuses a `crit`
  header. It accepts what jose accepts, except four things our signers never produce:
  - a token without `exp` (jose would accept it for ever);
  - an empty `sub`;
  - any part that is not strict, unpadded base64url (so a token has one spelling);
  - characters around the token.
- **Authorization header**: `Bearer`, in any letter case, then spaces or tabs, then the
  token. Node also took the byte `0xA0` for a separator; Go does not.
- **Refresh token**: 32 random bytes as base64url; the database stores its SHA-256.
- **Successor ciphertext**: `v1.<keyId>.<nonce>.<ciphertext>.<tag>`, AES-256-GCM, bound to
  its two session rows by the additional data. Go produces the TypeScript bytes for the
  same key and nonce, and reads only the canonical form (12-byte nonce, 16-byte tag,
  strict base64url).
- **Refresh classification** (`session.Classify`): the pure decision table of
  `docs/architecture/sessions.md`, equal to the TypeScript one on 672 recorded cases
  around every boundary.
- **Session protocol** (`session.Service`, queries in `store/queries/sessions.sql`): the
  protocol of `docs/architecture/sessions.md` on the shared tables.
  - One read-committed transaction per request, with `lock_timeout` 5 s and
    `statement_timeout` 10 s. The request time is read from the database clock before
    any lock wait. The family is locked first, then the session, then its successor.
  - `Start` (sign-in), `Refresh` (rotation, grace replay, or a refusal with the contract's
    code) and `End` (sign-out, idempotent). `InTransaction` and `RevokeUserFamilies` are
    the building blocks of the password reset (B3).
  - A refusal that changes data (reuse, expiry) commits. A lock, statement or pool
    timeout, or a deadlock, rolls everything back and answers `SESSION_BUSY`. A request
    that was cancelled, or ran out of its own time, gets its context's error instead.
  - A session or family deleted while the request waited (account deletion, the
    cleanup) is `INVALID_TOKEN`. A replay whose ciphertext is gone or does not match is
    `SESSION_RACE`, and nothing is revoked.
  - Ids are generated in Go until B7 (`platform.NewID`: `c` and 24 characters of
    `[a-z0-9]`, the shape of Prisma's cuid). Stored client details (user agent 200,
    device name 100) are cut as the Next.js API cut them and cleaned of bytes
    PostgreSQL refuses.
  - Tested against a real PostgreSQL with the settable database clock, in a non-UTC
    server time zone, with two pools standing in for two instances: the 24 cases of
    `session-protocol.itest.ts` ported one by one, and the cases the B1 review named.
- **Passwords**: bcrypt. New hashes use cost 12 and refuse more than 72 bytes (bcrypt
  would ignore the rest). Hashes from the Next.js server (cost 10) verify, including
  passwords over 72 bytes compared by their first 72 as before, and `NeedsRehash` marks
  them for replacement after a successful sign-in.

## Rate limits

`internal/ratelimit` bounds attempts per subject with fixed windows in PostgreSQL
(table `RateLimitBucket`, added by a Prisma migration: ADR 0007). Every instance sees
the same counters and they survive a restart; the Next.js limiter kept them in process
memory.

- A window starts at the subject's first attempt and ends on the database clock.
- `Take` counts one attempt against several buckets at once (an account and an address),
  or against none: if any is at its limit, nothing is counted and the caller answers
  `RATE_LIMITED` with the wait. `Refund` gives an attempt back, which is how a
  successful sign-in ends up not counted while failures stay.
- Concurrent attempts are serialised per bucket: no more than the limit ever pass in a
  window (tested with 40 at once). Buckets are locked in key order, so overlapping
  attempts cannot deadlock.
- A bucket that cannot be counted (locked past 2 s, database error) is an error, never
  a pass.
- The stored key is an HMAC-SHA256 of the rule and the subject, with a key derived from
  `JWT_SECRET` for this purpose only. An email or an address is never stored, and a
  database dump cannot be tested against guesses without the server's secret.
- Ended windows are removed by the hourly cleanup.

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
- The Next.js server adds security headers to API answers too (`X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`; `e2e/security-headers.spec.ts`). The Go server
  sets none yet: at the cutover they come from Go or from the reverse proxy, and that
  spec runs against the result.
- The runtime base image is pinned by digest. The build image
  (`golang:1.26.11-bookworm`) is pinned by tag only: Docker Hub rate-limited the digest
  lookup in the B0 session. Pin it by digest before the first production image.

## Database

Until B7, Prisma owns the `public` schema and its migrations (ADR 0007). The Go service
reads and writes data but changes no schema there.

- **Migrations** (`apps/api/migrations`, goose v3, embedded in the binary):
  - `00001_baseline.sql` equals the Prisma schema up to
    `20261125000000_rate_limit_bucket`, including the two `SystemMarker` rows.
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

  It also deletes expired idempotency keys, weather cache rows and ended rate-limit
  windows (last, and with `SKIP LOCKED`, so a sign-in never waits long for a bucket and
  the two cannot deadlock; tested). Consent records and quota history are never deleted. Each run logs its counts (`cleanup done`). A busy
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
- **E2E in Go mode** (CI job `e2e`, second run): the browser specs `auth`, `session` and
  `session-recovery` run again with the operations Go already serves answered by Go.
  `apps/web/e2e/go-front.mjs`, a test-only proxy, stands in front of a Next.js server
  and a Go server on one database and the same secrets, and sends those operations to
  Go and everything else to Next.js. In this arrangement every session is started by Go
  (sign-in is Go's); Next.js reads them and rotates them on page loads. Each answer is
  marked with the server that gave it, and `go-mode.spec.ts` checks the routing, so a
  misrouted run cannot pass. It also checks the other direction step by step: Next.js
  rotates a session, then Go serves a grace replay from the ciphertext Next.js stored
  and rotates the row Next.js wrote, and Next.js goes on from Go's. This arrangement is never deployed: production switches
  in one step (ADR 0002). Locally:

  ```bash
  cd apps/api && go build -o /tmp/lookly-e2e ./cmd/lookly
  cd ../web && E2E_GO=1 E2E_GO_BINARY=/tmp/lookly-e2e e2e/run-local.sh \
    auth.spec.ts session.spec.ts session-recovery.spec.ts go-mode.spec.ts
  ```
