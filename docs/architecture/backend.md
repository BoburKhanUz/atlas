# Go backend (`apps/api`)

The Go service replaces the Next.js API with the same contract (`docs/api/openapi.json`)
on the same PostgreSQL database (ADR 0001, ADR 0002). Until the cutover (B7) nothing
routes traffic to it; each stage adds endpoints behind tests. Rules for working in it:
`.claude/skills/lookly-go-backend/SKILL.md`. Stage plan: `docs/plan/README.md`.

## Request path

```
client ─► Wrap (middleware) ─► routed (404 for unknown routes) ─► gate (per route, in this order)
          request id           route pattern for the log and       1. cross-site request guard → 403
          30 s time limit      the gate                            2. access token + live session → 401
          access log                                               3. consent to the legal texts → 403
          panic → 500                                              4. request body rule → 400
          64 KB body limit                                                  │
                                                                            ▼
                                                     generated router: header, path and query
                                                     parameters, strict handler (decodes)
                                                     (or the media route, served by hand)
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
- **Handlers** (`internal/httpapi/server.go`, `server_account.go`): one method per
  operation. Each calls one service method and encodes the answer. No SQL and no
  business rules.
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
  rate limiter have their own, shorter lock and statement timeouts inside it. The
  upload has 90 s and a 10 MB body (the gate's `timeout` and `bodyLimit`); the
  server's own read and write deadlines move with it.
- **Security headers**: every answer carries `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and
  `Content-Security-Policy: frame-ancestors 'none'`, as the Next.js server sends them
  (`apps/web/next.config.ts`). A media path gets no policy from the middleware: an
  image sets `default-src 'none'`. `Strict-Transport-Security` is the reverse proxy's.
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
| `MEDIA_SIGNING_SECRET` | none (required) | signs the image links; the rules of `JWT_SECRET`, and not equal to it |
| `MEDIA_URL_TTL_SECONDS` | `3600` | lifetime of an image link: whole number, 60 – 86 400 |
| `SESSION_ENC_KEY` | none (required) | standard base64 of exactly 32 bytes (`openssl rand -base64 32`); neither the text nor the bytes of `JWT_SECRET` or `MEDIA_SIGNING_SECRET` |
| `SESSION_ENC_DECRYPT_KEYS` | none | up to 2 older keys, comma-separated, same rules; they decrypt only (staged key rotation) |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | whole number, 10 – 86 400 |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | whole number, 1 – 365 |
| `COOKIE_SECURE` | on in production and staging, off in development and test | `0` or `1`; `0` is refused in production |
| `TRUST_PROXY` | `0` | `0` or `1`; `1` only behind the reverse proxy that sets the forwarding headers |
| `PUBLIC_BASE_URL` | none | the site's public origin (scheme and host, no path, no default port); `https` in production and staging; required there when mail is sent (the links in e-mails); image links are absolute with it, relative without |
| `MAIL_TRANSPORT` | `disabled` in production and staging, `outbox` in development and test | `smtp`, `outbox` or `disabled`; `outbox` is refused in production and staging |
| `MAIL_FROM` | none (required for `smtp`); `Lookly <no-reply@localhost>` for `outbox` | an address or `Name <address>`, one line, at most 200 characters |
| `SMTP_HOST` | none (required for `smtp`) | host name without white space |
| `SMTP_PORT` | `587` | 1–65535 |
| `SMTP_SECURE` | on for port 465, off otherwise | `1`/`true` (TLS from the first byte) or `0`/`false` (STARTTLS, required unless the host is `localhost`, `127.0.0.1` or `::1`) |
| `SMTP_USER`, `SMTP_PASSWORD` | none | both or neither; the password is used as given and never printed |
| `MAIL_OUTBOX_DIR` | `./storage/mail-outbox` | for `outbox`: where messages are written as files |
| `AI_*`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | as in the Next.js server | the AI providers, models, timeouts, prices, the rollout switches, percentage and allowlist: the Next.js server's variables, read by its rules (`internal/config/ai.go`; the variables are listed in `docs/ai/provider-architecture.md` and `docs/ai/rollout.md`; golden vectors `testdata/golden/ai-config.json`). `NODE_ENV=production` there is `production` or `staging` here: no provider may be left unset, and a mock needs `AI_ALLOW_MOCK_IN_PRODUCTION=1`. Keys are never printed or logged. Every role is served by the provider it names (the garment analysis since B6.4, the outfit ranking since B6.5, the stylist since B6.6) |
| `WEATHER_PROVIDER` | `open-meteo` | who is asked for the weather: `open-meteo` (the Open-Meteo forecast service) or `mock` (the same demo weather everywhere, labelled as such). `mock` is refused in production and staging; any other value stops the server |
| `STORAGE_DRIVER` | `local` | `local` or `r2`; never guessed: an `R2_*` setting without it stops the server |
| `STORAGE_LOCAL_DIR` | none (required for `local`) | absolute path of the directory the images are in (the one the Next.js server writes to); `lookly serve` and `lookly worker` also require that it exists |
| `R2_ENDPOINT` | none (required for `r2`) | the account's S3 endpoint, an origin: `https://<account id>.r2.cloudflarestorage.com`; plain http only for a test server on the same machine, never in production or staging |
| `R2_BUCKET` | none (required for `r2`) | 3–63 lower-case letters, digits and hyphens |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | none (required for `r2`) | an R2 API token's S3 credentials; the secret is used as given (no white space around it) and never printed |
| `R2_REGION` | `auto` | the region requests are signed for |
| `STORAGE_SWEEP_MAX_REMOVALS` | none | how many orphaned image files one storage sweep removes at most: whole number, 1 – 1 000 000. Unset, a run removes at most as many orphans as it found old files with an image row, never more than 1000, and always up to 50. A sweep that finds more removes nothing and fails; set it for a run only after checking that the worker's database is the right one |

The session variables are shared with the Next.js server and follow its rules, with two
differences: Go refuses a value out of range or malformed, where the Next.js server
silently used the default or the nearest limit; and Go refuses `COOKIE_SECURE=0` in
production. `serve`, `worker` and `migrate river` validate the whole configuration, so
all three need the secrets, `STORAGE_LOCAL_DIR` and valid mail settings (a one-off
`migrate river` runs with the service's own environment); `health` reads only
`LOOKLY_HTTP_ADDR`. In production
without `TRUST_PROXY=1` the server logs a warning at start: client addresses are then
unknown, so sign-in is limited per account only and registration shares one limit.

The mail variables are the Next.js server's (`apps/web/src/server/mail-config.ts`), with
these differences: the outbox is refused in production and staging without exception
(`MAIL_ALLOW_OUTBOX_IN_PRODUCTION` is not read), `MAIL_FROM` must also parse as an RFC
5322 address, `PUBLIC_BASE_URL` must be `https` in production and staging and is
required for SMTP in staging too, and `STORAGE_LOCAL_DIR` has no default (a wrong guess
would purge nothing without anyone noticing).

The media variables are the Next.js server's (`apps/web/src/lib/config.ts`), with these
differences: Go refuses a lifetime out of range or malformed (Next.js used the default
for a malformed one and had no limits), a secret with white space at its ends, and the
same secret for `JWT_SECRET` and `MEDIA_SIGNING_SECRET` (whoever learns one would hold
both).

Later stages add their settings (AI) to the same check.

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
   `Origin: null` is another host; no `Origin` passes (the mobile app sends none). Where
   cookies are Secure, an `Origin` that is not https is another site too. Behind
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

## Account operations (B3)

Behaviour and decisions: `docs/plan/B3.md`. Request bodies are judged as the Next.js
schemas judge them (`testdata/golden/account-validation.json`).

- **Legal texts** (`GET /legal`, public): an embedded JSON copy of the texts the web app
  owns until the cutover (`internal/legal/documents.json`, written by
  `apps/web/scripts/legal-bundle.ts`). A test in each app fails when the copy is stale
  or is not the version consent is taken for.
- **Consent** (`POST /legal/consent`, served although the consent is out of date): one
  row per user and version; the user's row is locked while the check and the insert run.
  The consent check of the gate reads the 20 newest consents of a user.
- **Profile** (`internal/profile`): the read returns the stored rows and the preferences
  with their lists as lists; the change applies name, profile fields and preferences in
  one transaction (`null` clears a field, an absent member keeps it; a section that is
  present moves its row's `updatedAt` and creates the row for an account that has none).
  Style and colour lists stay JSON text until B7; stored text that is not a JSON list of
  strings is a 500 with the cause logged, never an empty list.
- **Password reset** (`internal/accounts/reset.go`, `resetmail.go`):
  - the request looks the address up and queues one job either way, carrying the user's
    id or nothing: the same answer after the same work, and no address in the queue.
    Limits: 3 per hour per mailbox, 10 per hour per client address (or one shared bucket
    of 200 when the address is unknown). Without a mail transport it answers 503
    `PASSWORD_RESET_UNAVAILABLE`;
  - the job stores the hash of a new 256-bit token (valid 60 minutes), sends the
    message, and then ends the user's earlier links. A message that does not leave
    leaves no new link; the job is tried 4 times, and a request older than 30 minutes is
    dropped;
  - the reset is one session-protocol transaction: the user's session families are
    locked first, then the user's row, then the token's; the new hash is set, the user's
    links are deleted and every live family is revoked (`password_reset`). 20 per hour
    per client address (shared: 300). A password over 72 bytes is refused.
- **Account deletion** (`internal/accounts/delete.go`, served although the consent is out
  of date): one session-protocol transaction that locks the user's session families,
  queues the job that removes the images, and deletes the user's row; the schema's
  cascades remove everything the user owns (a test walks the foreign keys). Every token
  of the account stops working with the commit. The job exists if and only if the
  deletion commits. Asked again with a token of the deleted account (the app's check
  after a lost answer), the route answers 404 `NOT_FOUND`: the gate's `goneIsNotFound`
  rule, which looks the account up for a token of ours whose session is gone.
- **Locks**: what changes all of a user's sessions takes the families' locks before the
  user's row, as a refresh takes its family first (`docs/architecture/sessions.md`).
  What changes an account locks the user's row `FOR NO KEY UPDATE`: such changes go one
  at a time, and a session being created for the user is not held up.

## Mail

`internal/mail` sends one message to one recipient, as text and HTML
(multipart/alternative, quoted-printable, UTF-8 headers in RFC 2047 form). Standard
library only.

- **SMTP**: TLS from the first byte (`SMTP_SECURE`) or STARTTLS, which is required for
  every server that is not on this machine; TLS 1.2 or newer with the certificate
  verified. Sign-in by `PLAIN`, or `LOGIN` when the server offers only that; credentials
  go only over TLS or to this machine, and a server that offers no sign-in gets no
  message when credentials are configured. 10 s to connect, 30 s for the delivery.
- **Outbox** (development and tests): one JSON file per message, in the format the
  Next.js server writes (`from`, `to`, `subject`, `text`, `html`, `createdAt`; file mode
  0600, directory 0700). The e2e specs read the links from there.
- The recipient must be one bare ASCII address and the subject one line. Errors never
  show the message, and the recipient's address is replaced in them (a server's refusal
  often quotes it): errors are logged and kept with the job.
- Not verified against a real provider: the tests use a fake SMTP server. The first real
  send is a staging step with the owner (provider account, SPF and DKIM for the sender's
  domain).

## Background jobs

`internal/jobs` (River, schema `river`). `lookly serve` only puts jobs into the queue
(`jobs.Queue`); `lookly worker` runs them.

| Job | Queued by | Does | Attempts |
|---|---|---|---|
| `maintenance_cleanup` | the worker, hourly and at start | removes expired rows (B1) | 3 |
| `password_reset_mail` | a reset request | makes a link and e-mails it; carries a user id or nothing | 4 |
| `account_purge_images` | an account deletion, in its transaction | removes `users/<id>` from the storage directory | River's default (25, over about three weeks) |
| `storage_sweep` | the worker, hourly and at start | removes stored image files no image row names and older than an hour (`wardrobe.Sweeper`), each asked about once more just before it is removed; removes nothing and fails when it finds more of them than it may remove (by its own rule as many as the known files, at most 1000, always up to 50; or `STORAGE_SWEEP_MAX_REMOVALS` when that is set) or when the database holds no image row at all; names we never make are logged, never removed | 3 |

Job rows hold user ids, never addresses or tokens. River keeps finished jobs for a day.

## Storage

`internal/storage` defines `Store` (put, get, delete, delete an owner's images, list)
and the local driver over `STORAGE_LOCAL_DIR`, laid out as the Next.js server lays it
out: `users/<owner>/<uuid>.<jpg|png|webp>` (master), `_display.webp`, `_thumb.webp`.
Every key is checked against the pattern of the keys we make before a path is built
from it. A file is written under a temporary name and renamed into place, so a reader
never sees half of one; files are `0644` in `0755` directories because until the
cutover both servers, in their own containers, share the volume. `DeleteOwner` removes
`users/<id>` (ids of the users' form only; a link in place of the directory is removed,
not followed).

The `r2` driver keeps the same keys in a Cloudflare R2 bucket through the S3 API, with
a small client of our own (ADR 0010; `internal/storage/r2.go`, `sigv4.go`): one signed
request per object, no redirects followed, no retries, failures reported by status and
error code only. At start, `serve` and `worker` ask the bucket one question
(`R2.Check`): a refusal of the request stops them, no answer is logged. It has not run
against a real S3-compatible service yet (ADR 0010).

## Wardrobe

`internal/wardrobe` lists, reads, corrects and deletes a user's items; every query names
the owner, so an item of another user is `NOT_FOUND`, never `FORBIDDEN`. The routes'
gate rules judge the path id (`ItemID`), the list query (`WardrobeListQuery`, which
also fills in the default limit and rewrites the query for the generated decoder) and
the correction body (`WardrobePatchBody`) by the Next.js schemas' golden cases.

- **List**: newest first, then by id; `cursor` is the id of the last item of the page
  before, and must be an item of the caller's (anything else is an empty last page).
- **Correct**: the item's row is locked, the patch is compared with it by the Next.js
  rules (`apps/web/src/lib/wardrobe/corrections.ts`; golden vectors in
  `testdata/golden/wardrobe.json`), and the changed columns, `wasCorrected`, the
  appended `correctionLog` and `updatedAt` are written in one statement. A subcategory
  that does not belong to the category the item ends up with is `VALIDATION_ERROR`.
- **Delete**: the item's rows first (its image rows and outfit entries go by cascade),
  then its files, with a context of their own; a file that cannot be removed is logged
  and left to the sweep.
- **Upload** (`wardrobe.Uploads`, `internal/httpapi/server_upload.go`): the gate's
  header rule judges the `Idempotency-Key`, the declared length and the form's type
  before the body is read; the route has its own budget (10 MB, 90 s; the gate's
  `bodyLimit` and `timeout`). Then, in order: the idempotency claim
  (`internal/idempotency`: the Next.js API's rows and request hash), the item limit
  (1000), the day's count (100 a day of Uzbekistan time, in the rate limiter), the
  picture (`internal/imaging`), the three files, the mock's detection
  (`internal/vision`), and one transaction that locks the user, checks the item limit
  again, creates the item and its image row and completes the claim. A failure at any
  step gives back what was taken before it: the files, the day's count, the claim.
- **Answers** have the Next.js serializer's shape (`serializeWardrobeItem`): lists
  decoded, times with milliseconds, images as signed links (`url` is the display
  variant, or the master for an image from before the variants). Storage keys never
  leave the server.

## Media links

`internal/media` signs and checks the image links exactly as the Next.js server does
(`apps/web/src/lib/storage/media.ts`; golden vectors in `testdata/golden/media.json`):
`/api/v1/media/<key>?exp=<unix seconds>&sig=<HMAC-SHA256 of key, newline, exp, unpadded
base64url>`, absolute with `PUBLIC_BASE_URL`. A link opens through its expiry second.
`GET /api/v1/media/<key>` is served by hand (`internal/httpapi/server_media.go`): the
key holds slashes, which a generated pattern matches as one segment, and the router's
wildcard would redirect paths with `..` or `//` instead of refusing them. Every path
under the prefix is that route, public in the gate (the link is the credential). A bad,
expired or unsigned link, a key we never make and a missing image all answer 404 alike;
an image is sent with its type by extension, `Cache-Control: private, max-age=3600`,
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'`.
The access log records the route pattern, never the path or the query (which hold the
key and the signature).

## Weather

`internal/weather` answers the weather of a place (`GET /api/v1/weather/current`, and
outfit generation). A place leaves the server, and is known to the cache, only as its
cell: both coordinates rounded to two decimals (about a kilometre), written as
JavaScript's `toFixed(2)` writes them (`weather.CellOf`).

- **Cache**: the `WeatherCache` table, one row a cell, 30 minutes, shared with the
  Next.js API until the cutover (the same key and row format). A row that is not a
  complete, sensible weather counts as no row and is replaced. Expired rows are removed
  by the cleanup.
- **Provider** (`WEATHER_PROVIDER`): Open-Meteo (`weather.OpenMeteo`: 5 s, no redirect
  followed, at most 64 KiB read) or the mock. An answer is a weather only when every
  member we use is there and within the range the API accepts in a client's weather
  snapshot; anything else is an error and nothing is cached. The chance of rain is the
  mean of the six hours from the hour of the answer, in the place's own time. The
  labels are the Next.js provider's (`testdata/golden/weather.json`).
- Requests for one cell at the same time share one question to the provider; it goes
  on when the request that started it gives up, and its answer is cached.
- A cell that is not in the cache costs a question to the provider, counted in the
  rate limiter: 30 an hour for a user, 300 an hour for everyone
  (`weather.AskPerUser`, `weather.AskShared`). Past that the weather route answers
  `RATE_LIMITED` and generation goes on without the weather; the cache still answers.
- A question has its own time limits (five seconds for the provider, ten with the
  cache write), whatever the request allows; a panic in it is its error.
- A provider's failure is `INTERNAL` on the weather route and "no weather" for outfit
  generation. The place is in no log line and no
  error: the address asked is cut out of the HTTP client's errors.

## Outfits

`internal/engine` is the outfit engine: a pure function (no database, clock or
randomness) from a wardrobe, the weather, an occasion, the user's preferences, colour
profile and recent feedback to scored outfits with their reasons. It is the TypeScript
engine (`apps/web/src/lib/ai/outfit-engine.ts`, `outfit-engine-v2`) ported rule by
rule: its tables are a JSON copy generated from the TypeScript modules
(`internal/engine/tables.json`; a test in the web app fails when the copy is stale), and
163 golden cases (`testdata/golden/engine.json`) must give the same outfits in the same
order with every field equal, the unrounded scores to the bit. JavaScript's arithmetic
is reproduced where it differs from Go's (`internal/engine/jsnum.go`,
`platform.RoundHalfUp`).

`internal/outfits` is the use cases; every query names the owner.

- **Generate** (`POST /api/v1/outfits/generate`): at most 20 a minute for a user
  (`outfits.GeneratePerUser`, `RATE_LIMITED` past it). One read-only transaction reads the
  wardrobe, the preferences, the stored colour profile and the feedback of the last 30
  days; the weather is the client's snapshot, else the weather of the place (through
  the cache), else none; the engine; the deterministic explanation
  (`engine.Explanation`). Nothing is stored. Until the AI ranking of stage B6 the
  answer is always `fallback: true`. Stored lists that are not lists count as empty
  here and are logged: one bad row does not stop the outfits.
- **Save** (`POST /api/v1/outfits`) judges in the Next.js route's order: roles nobody
  has, an item twice, items that are not the user's (`FORBIDDEN`), a role its item's
  kind may not have, the composition (`engine.ValidateComposition`). The items are
  locked against removal until the outfit is stored; each item's row is a millisecond
  after the one before, which is the order they are read in.
- **List** (the 50 newest, all or saved), **read**, **change** (`isSaved`, `name`),
  **delete** (items and feedback go by cascade) and **feedback** (the feedback row and
  the change of `isSaved` it implies, in one transaction). An outfit of another user is
  `NOT_FOUND`.
- **Answers** are the Next.js routes', member by member, including the members of the
  database row that the contract allows but does not list (`userId`, `reasonsJson`, the
  weather as stored text after a write): the web tests read them. Cutting them is a
  contract change for a later stage.
- The gate's rules judge the bodies, the list's `saved` and the path id by the Next.js
  schemas' golden cases (`testdata/golden/outfit-validation.json`).

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

## AI

Stage B6, under way: the parts below exist; the features that use them arrive slice
by slice (`docs/plan/B6.md`).

- **Providers** (`internal/ai`): `Client` gives a feature its text or vision provider
  from the settings (Gemini, OpenAI or the mock), with one retry, a deadline per call
  and one record per call for the monitoring. Errors are typed (`ai.Error` with a
  `Kind`); a key never appears in an error or a log line. What the adapters send is
  held to the Next.js adapters by golden request bodies
  (`testdata/golden/ai-providers.json`).
- **Quotas** (`internal/quota`): a user's calls per feature and day (stylist 50,
  garment analysis 50, outfit explanation 30, colour analysis 10), counted in
  `AiUsage` by one statement that cannot pass the limit however many requests arrive
  at once (tested with 80 against 50). The day is the calendar day in Tashkent
  (UTC+5) on the database clock. `Charge` answers with the time until the next day
  for `Retry-After`; `Refund` gives a unit back to the day it was taken from, never
  below zero, and is made even when the request has ended.
- **Rollout** (`ai.Eligible`): a feature's switch, then the allowlist (SHA-256 digests
  of user ids, never the ids), then the user's stable bucket (0 to 99) against the
  percentage. The buckets and digests are the Next.js server's
  (`testdata/golden/ai-monitoring.json`), so a user keeps their place across the
  cutover.
- **Garment analysis** (`vision.Analyzer`, in the upload, after the files are stored):
  the development mock for a user the rollout leaves out or when the vision provider is
  the mock; else the picture prepared by `imaging.PrepareVision` (upright, on white,
  within `AI_VISION_MAX_SIDE`, JPEG, no metadata), a blur check that answers "unclear"
  without asking, the day's quota, the provider with the instruction and schema of
  version v2, `vision.Interpret` (the only way a model's answer reaches the database:
  refused whole when it breaks the schema or the catalog) and the colour check, which
  can only lower the colour's confidence. Confidences shown are capped at 0.69; the
  model's own are stored beside them. The answers: `AI_UNAVAILABLE` (503, refunded),
  `AI_QUOTA_EXCEEDED` (429 to the next Tashkent midnight), `NOT_A_GARMENT` (422,
  charged when the model looked), `INVALID_IMAGE` (422).
- **Outfit ranking** (`outfits.Ranker`, after the engine): the model may only reorder
  the engine's candidates (O1…On in its context: catalog values only, never ids) and
  explain the one it selects; one correction after an invalid answer; at most 25 s for
  both attempts. Its explanation is shown only when it follows the Uzbek output policy
  (no English catalog words, no Cyrillic). Any failure, the mock, the rollout or the
  day's quota (30) gives the engine's own order and explanations: generation never
  fails because of it. `fallback` in the answer says which.
- **Stylist chat** (`stylist.Service`, `POST /api/v1/stylist/chat`): the conversation's
  owner (else 404, never a new one), the `Idempotency-Key` (judged after the body;
  claimed before any AI work; the hash is the Next.js `jsonRequestHash`), a bounded
  context (at most 40 items as W1…Wn with catalog values only, never ids or stored free
  text; the engine's top 3 candidates for the event's occasion and a complete weather;
  the preferences; the colour profile's summary; the last 12 meaningful messages), the
  rollout (off: `AI_UNAVAILABLE` without a call), the mock (labelled "Demo rejim:", no
  quota) or the day's quota (50) and the provider with the prompt of version v2. The
  answer is validated and its references checked; unknown references get one
  correction, malformed output none; 50 s for the whole turn. References become item
  names. The user's message and the answer are stored in one transaction that also
  completes the key; any failure stores nothing, gives the call back and releases the
  key (`AI_UNAVAILABLE` 503 with `Retry-After: 15`, `AI_QUOTA_EXCEEDED` 429 to the
  next Tashkent midnight). The list shows the 50 latest changed conversations with
  their last message; a conversation shows its newest 1000 messages, oldest first.
- **Colour profile** (`color.Service`, `/api/v1/color-profile`): a selfie (JPEG, PNG
  or WebP, at most 8 MB, shortest side at least 256) becomes a canvas in memory
  (`imaging.Processor.Canvas`: upright, within 320 pixels, on grey), is analysed by
  `color.AnalyzeCanvas` (color-analysis-v2: deterministic, no model, no network) and
  dropped; each analysis counts against the day's (`color_analysis`, 10 a day; a file
  its header refuses is not counted; given back when it was not made or not stored;
  over it `429 AI_QUOTA_EXCEEDED`); nothing of the picture is stored or logged. The result
  replaces the user's one profile and the user profile points at it, with the skin
  tone, undertone, hair and eye colour, in one transaction. Refusals:
  `PHOTO_QUALITY_TOO_LOW` (with the reason), `SKIN_NOT_VISIBLE`, `INVALID_IMAGE`,
  `IMAGE_DIMENSIONS`. DELETE removes the profile and those values.
- **Client error reports** (`clienterrors.Service`, `POST /api/v1/client-errors`, no
  session): 1 to 10 reports per request, each one `client error` line in the log at
  level ERROR, its texts scrubbed (e-mail addresses, Bearer values, JWTs, URL queries,
  long opaque values; ids in the route as `:id`) and redacted again as the Next.js log
  did; nothing is stored. Limits: 30 requests in 10 minutes per address (when the
  address is known), 300 for everyone. `GET /api/v1/openapi.json` serves the contract
  as it is (a copy in `internal/httpapi/contract`, kept by `scripts/generate.sh`).
- **Monitoring** (`ai.Monitor`): the events `ai.call`, `ai.request` and `ai.quota`,
  one JSON log line each, the event's name as the message. Every event passes a
  whitelist per event: only known fields of the right kind, and a text only when it is
  a short lowercase code, so that no prompt, answer, address or id can be written even
  when a caller passes one by mistake. `apps/web/scripts/ai-monitor.ts` aggregates
  the lines.

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
  it. It refuses to start without River's tables and without the storage directory.
- `lookly serve` queues jobs (password reset, account deletion) and so needs River's
  tables too. It starts without them, as it starts without the database; until they
  exist those two operations answer 500 and the log says to run `lookly migrate river`.
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
- Deploy order: `lookly migrate river` before `serve` and `worker`. The worker needs the
  storage volume mounted at `STORAGE_LOCAL_DIR` (read-write), the mail settings and
  `PUBLIC_BASE_URL`; the server needs the same mail settings (it answers 503 on a reset
  request when mail is disabled).
- Account deletion relies on the schema's cascades. The foreign keys of the wardrobe's
  child tables have their indexes since the migration `20261126000000_wardrobe_child_indexes`
  (`WardrobeImage.wardrobeItemId`, `OutfitItem.outfitId`, `OutfitItem.wardrobeItemId`); it
  has to be run on every deployed database (owner's go-ahead). `AiConversation.userId`
  still has none (porting.md): add it before conversations grow (B6).
- The storage sweep compares the storage with the worker's database. Stop the worker
  while a database is restored or replaced: against an older copy, the files uploaded
  since look like orphans. The sweep refuses to remove anything when the database holds
  no image row at all or when it finds more orphans than it may remove (see
  `STORAGE_SWEEP_MAX_REMOVALS`), and fails its job (`storage sweep failed` in the log)
  until somebody has looked.
- Mail: choose the provider, create its account and set SPF and DKIM for the sender's
  domain (owner). Send the first message on staging with the owner's approval; nothing
  here was verified against a real provider. The privacy policy names the provider.

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
    `20261126000000_wardrobe_child_indexes`, including the two `SystemMarker` rows.
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
  files are the storage sweep's (`storage_sweep`, above).

## Tests and CI

- Handlers are tested over `httptest` through the real router and middleware. Every
  response body is validated against the contract (`internal/contracttest`: JSON Schema
  2020-12, ECMAScript regex; ADR 0008).
- Integration tests carry the build tag `integration` and need `LOOKLY_TEST_DATABASE_URL`
  (a PostgreSQL 16). They fail, never skip, when it is missing.
- CI job `api` does the following:
  - checks the generated code, `gofmt`, `go vet`, staticcheck v0.8.2 and govulncheck v1.9.0;
  - runs `go test -race -tags integration,nodynamic ./...` against a PostgreSQL 16 service
    (`nodynamic` on every build and test: the WebP encoder is the transpiled one, never
    a libwebp of the machine; ADR 0009);
  - builds the binary.

  The `docker` job builds the image.
- **E2E in Go mode** (CI job `e2e`, second run): the whole browser suite runs again
  with the whole API answered by Go (every operation of the contract since B6.10).
  `apps/web/e2e/go-front.mjs`, a test-only proxy, stands in front of a Next.js server
  and a Go server on one database and the same secrets, and sends everything under
  `/api/` to Go and the pages to Next.js. `apps/web/e2e/go-worker.mjs` runs
  `lookly migrate river` and the Go worker, which writes the reset mails to the same
  outbox directory the specs read. In this arrangement every session is started by Go
  (sign-in is Go's); Next.js reads them and rotates them on page loads. Each answer is
  marked with the server that gave it, and `go-mode.spec.ts` checks the routing, so a
  misrouted run cannot pass. It also checks the other direction step by step: Next.js
  rotates a session, then Go serves a grace replay from the ciphertext Next.js stored
  and rotates the row Next.js wrote, and Next.js goes on from Go's. For the weather and
  the outfit routes it asks both servers the same things directly, on the same data, and
  compares the answers member by member (they may differ in link signatures, in the ids
  and times of rows each made, and in the image dimensions of the outfit list). This
  arrangement is never deployed: production switches
  in one step (ADR 0002). Locally:

  ```bash
  cd apps/api && go build -tags nodynamic -o /tmp/lookly-e2e ./cmd/lookly
  cd ../web && E2E_GO=1 E2E_GO_BINARY=/tmp/lookly-e2e e2e/run-local.sh \
    auth.spec.ts session.spec.ts session-recovery.spec.ts go-mode.spec.ts \
    password-reset.spec.ts reconsent.spec.ts navigation-responsive.spec.ts
  ```
