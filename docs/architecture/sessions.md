# Sessions

Server code: `src/server/session/protocol.ts` (protocol), `classify.ts` (pure
decision table), `successor-crypto.ts`, `maintenance.ts`; route glue in
`src/lib/session.ts`. Database: `SessionFamily`, `Session`, `SystemMarker`,
function `atlas_now()` (migration `20261006000300_session_families`).

## Model

- **Session family** = one login on one device. `clientType` (`web` |
  `mobile`) and `absoluteExpiresAt = createdAt + 90 days` are fixed at login.
  Families migrated from Phase 2 get a bounded transition limit instead
  (`LEAST(C + 90 d, GREATEST(chain start + 90 d, C + 30 d))`, `C` =
  `legacyCutoverAt`; `docs/database/cutover.md`, *Legacy session lifetime*).
  `revokedAt` / `revokeReason` (`logout`, `reuse`, `expired`, `migrated`,
  `anomaly`) end the whole family.
- **Session** = one refresh token (stored as SHA-256 only). Every refresh
  rotates: the presented row gets `revokedAt = rotatedAt = t`,
  `replacedById = successor`, and `successorTokenEnc` (the successor token,
  AES-256-GCM with `SESSION_ENC_KEY`, bound to both row ids). A successor
  expires at `min(t + 30 days, family limit)`.
- **Access token**: HS256 JWT with `sid`, valid `min(15 min, family limit)`.
  Not checked against the database per request — a revoked family keeps API
  access for at most 15 minutes.

## Refresh protocol

One transaction per request (READ COMMITTED, primary database only):
`lock_timeout 5 s`, `statement_timeout 10 s`; `t := atlas_now()` (UTC, ms,
read before any lock wait); find the session by token hash; lock the family
`FOR UPDATE`, then the session (then its successor). Family first, always:
refreshes, replays and revocations of one family are serialised and cannot
deadlock each other.

| Condition (under the family lock) | Result |
|---|---|
| token unknown | 401 `INVALID_TOKEN` |
| family revoked, or session revoked without a successor | 401 `SESSION_REVOKED` |
| family `clientType` ≠ request mode | 401 `CLIENT_MISMATCH` (nothing changes) |
| `t ≥ absoluteExpiresAt`, or a live session with `t ≥ expiresAt` | family revoked (`expired`), 401 `SESSION_EXPIRED` |
| session live | **rotate** → 200 |
| rotated by this protocol, `t − rotatedAt ≤ 60 000 ms` | **grace replay**: if the successor is still the live tail of the family and the stored ciphertext decrypts to a token with the successor's hash → 200 with the **same** successor refresh token and a new access token; otherwise 401 `SESSION_RACE` (no tokens, nothing revoked) |
| rotated, `t − rotatedAt > 60 000 ms` | family revoked (`reuse`), 401 `REFRESH_REUSED` |
| rotated before the cutover (`rotatedAtSource = 'legacy'`) | `t − legacyCutoverAt > 60 000 ms` → reuse; otherwise `SESSION_RACE`. Legacy `rotatedAt` values are never trusted |
| lock wait > 5 s, deadlock, pool exhausted | 503 `SESSION_BUSY`, `Retry-After: 1`, no side effects |

A family revocation (logout, reuse, expiry) also stamps `revokedAt` on every
live session of the family and clears stored ciphertexts in the same
transaction. Logout revokes the family of the presented refresh token (or of
the access token's `sid`, scoped to its user) and is idempotent.

## Client modes

`X-Atlas-Client: mobile` selects the response format; any other value (or
none) is web. It is not a security boundary: the family's stored
`clientType` decides, and a token used in the other mode gets
`CLIENT_MISMATCH`.

| Endpoint | Web | Mobile |
|---|---|---|
| `POST /api/v1/auth/register`, `/login` | `{ user }` + HttpOnly cookies `atlas_at` (Max-Age = access lifetime) and `atlas_rt` (Max-Age = refresh lifetime), `Path=/`, `SameSite=Lax` | body: `{ user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionExpiresAt }`, no cookies; optional `deviceName` (≤ 100 chars) in the request |
| `POST /api/v1/auth/refresh` | reads `atlas_rt`; 200 `{ user }` + cookies | body `{ refreshToken }`; 200 with the token body above |
| `POST /api/v1/auth/logout` | cookies and/or access `sid`; clears cookies | body `{ refreshToken }` and/or Bearer `sid` |
| other API routes | `atlas_at` cookie | `Authorization: Bearer <accessToken>` |

Errors use the shared contract `{ error, code, requestId }`. Retryable:
`SESSION_RACE` (401) and `SESSION_BUSY` (503 + `Retry-After`); web cookies are
left untouched. Terminal (`INVALID_TOKEN`, `SESSION_EXPIRED`,
`SESSION_REVOKED`, `REFRESH_REUSED`, `CLIENT_MISMATCH`): web cookies are
cleared; clients discard their tokens and show login. Clients never call
logout because a refresh failed.

## Client recovery

Machine-readable contract: `docs/api/client-recovery-vectors.json` (also the
reference for the Flutter app). Web implementation: `src/lib/session-recovery.ts`
used by `src/lib/api-client.ts`; page loads: `src/proxy.ts`.

- One recovery episode per tab after a 401; at most 3 refresh calls.
- `SESSION_RACE`: wait 300–800 ms and retry the request without refreshing;
  still 401 → one more refresh; a second race → login.
- `SESSION_BUSY`: wait `Retry-After` + jitter; after 3 → inline "server busy"
  message, session kept, 30 s cool-down without automatic refreshes.
- Network error / timeout (12 s per call): retry after 1 s, then 2 s, only within
  45 s of the first attempt; then "network error", cookies kept, 30 s cool-down.
- Terminal codes: `/login?next=…&expired=1`. The client never calls logout
  because a refresh failed.
- Page loads (proxy): `SESSION_RACE`/`SESSION_BUSY` → one automatic retry of the
  same URL (5 s `atlas_retry` cookie), a second one → `/login?next=…` with the
  session cookies kept (the login page renews them if still valid).

## Keys

`SESSION_ENC_KEY` (32 bytes, base64) is independent of `JWT_SECRET` and
`MEDIA_SIGNING_SECRET`; the server refuses to start otherwise. Rotation:
1. put the new key into `SESSION_ENC_DECRYPT_KEYS` on every instance;
2. make it `SESSION_ENC_KEY` and move the old key to `SESSION_ENC_DECRYPT_KEYS`;
3. after a few minutes (> 60 s), remove the old key.
Removing a key without staging only makes replays inside the 60 s window fail
closed (`SESSION_RACE`).

## Operations

`bun scripts/session-cleanup.ts` (dry run; `--apply` to change data; `--json`):
clears ciphertexts older than 60 s, deletes rotated sessions and whole
families revoked or expired more than 30 days ago. A deleted old token then
reads as `INVALID_TOKEN` instead of `REFRESH_REUSED`.

`bun scripts/session-cleanup.ts --preflight-families` — read-only, run
against the Phase 2 database before the cutover (`docs/database/cutover.md`):
predicts the families and anomalies the migration will create. Exit 2 =
anomalies (those families are revoked at the cutover), 3 = duplicate links
(the migration would fail).

## Tests

- `tests/unit/session-classify.test.ts` — every boundary (60 000 / 60 001 ms,
  absolute limit, legacy rules).
- `tests/integration/session-protocol.itest.ts` — real PostgreSQL with a test
  clock: rotation, grace, reuse, forced lock contention (two Prisma clients),
  key rotation, legacy rows, revocation stamping, real-clock smoke.
- `tests/integration/session-http.itest.ts` — routes and proxy, web and mobile.
- `tests/integration/session-maintenance.itest.ts`, preflight checks in
  `migration-chain.itest.ts`.
- `tests/integration/legacy-transition.itest.ts` — legacy lifetime: migrated
  chains of different ages, refresh, replay, expiry boundary, logout, new
  logins, rollback and roll forward; RB-07 in `phase2-rollback.itest.ts` with
  the real Phase 2 build.
