# Session-families cutover and rollback

Migrations `20261006000100_media_variants`, `20261006000200_idempotency_keys`
and `20261006000300_session_families` ship together with the new session
protocol. The cutover is **stop-the-world**: the old (Phase 2) build and the
new build never run at the same time.

## Why stop-the-world

`session_families` makes `Session.familyId` NOT NULL. Every Phase 2 session
insert (login, rotation) fails after it. The new build, in turn, needs every
session to have a family. There is no mixed-version window.

## How the migration behaves

- Prisma sends each `migration.sql` as one query, which PostgreSQL runs as one
  transaction: an error anywhere leaves schema and data unchanged (tested by
  `tests/integration/migration-atomicity.itest.ts`). Prisma records the failure
  in `_prisma_migrations`; see *Recovering from a failed migration* below.
- `LOCK TABLE "Session" IN ACCESS EXCLUSIVE MODE` (30 s lock timeout) blocks
  any straggling writer until the migration commits; a writer that commits
  while the migration waits is migrated with everything else.
- `SystemMarker.legacyCutoverAt` is read with `clock_timestamp()` after the
  lock is granted, in UTC, rounded up to the next millisecond. Every legacy
  row write is therefore strictly earlier (`migration-cutover.itest.ts`).
  `migrationStartedAt` is informational only.
- Every session gets exactly one family (`migration-chain.itest.ts`). Chains
  that are inconsistent — cycles, links to missing sessions, user mismatch,
  `createdAt` going backwards, a live session that is not the chain tail — get
  a family revoked at the cutover (`revokeReason = 'anomaly'`): those users
  sign in again. Fully revoked chains get `revokeReason = 'migrated'`.
- Two sessions pointing at the same successor make the migration fail (the
  unique index on `replacedById` cannot be built). Nothing is changed.
- Every migrated family gets a bounded absolute limit; see *Legacy session
  lifetime*.

## Legacy session lifetime

Phase 2 sessions slide (every refresh extends them by 30 days) and have no
absolute limit. A migrated family therefore cannot simply get
`chain start + 90 days`: every active user whose first login is older than
90 days would be signed out at the first refresh after the cutover. Instead,
with `C = legacyCutoverAt`:

```
absoluteExpiresAt = LEAST(C + 90 days, GREATEST(chain start + 90 days, C + 30 days))
```

| Chain started (relative to C) | Limit | Effect |
|---|---|---|
| less than 60 days before | chain start + 90 days | same as a login made then (more than 30 days left) |
| 60 days or more before | **C + 30 days** (transition window) | keeps working for 30 days, then one sign-in |
| after C (clock skew) | C + 90 days | never later than a fresh login |

Exact boundary: a refresh at `t < absoluteExpiresAt` is decided as usual;
at `t >= absoluteExpiresAt` it returns 401 `SESSION_EXPIRED`, the family is
revoked (`expired`), the web client clears its cookies and shows
`/login?next=…&expired=1`. Within the window refresh tokens expire at
`min(t + 30 days, limit)` and access tokens at `min(t + 15 min, limit)`
(JWT whole seconds, never later than the limit), so no token outlives it. A
session that is not used for 30 days still expires as in Phase 2. The next
login creates a normal family (`createdAt + 90 days`).

Unchanged: logins after the cutover (web and mobile) always get
`createdAt + 90 days`; there are no legacy mobile families; reuse
detection, logout, revocation and client binding apply to migrated families
exactly as to new ones. Logged-out and anomalous chains stay revoked.

The preflight (`--preflight-families`) prints how many live chains keep
`chain start + 90 days` and how many get the transition limit, and the
transition end date for a cutover now (`legacyLifetime` in `--json`).

## Procedure

1. **Back up** the database (`pg_dump -Fc`). Keep it until the new build has
   been stable for a while; see R-D for why it must not be restored after
   traffic.
2. **Pre-check** (read-only) — must return no rows:

   ```sql
   SELECT "replacedById", count(*) FROM "Session"
    WHERE "replacedById" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
   ```

   If it returns rows, stop and investigate; do not edit rows by hand without
   a reviewed remediation script. Then run the read-only preflight
   (`bun scripts/session-cleanup.ts --preflight-families`) and record its
   anomaly and legacy-lifetime counts.
3. **Configure** the new build: `SESSION_ENC_KEY` (32 random bytes, base64),
   `PUBLIC_BASE_URL`, and the existing secrets.
4. **Stop every Phase 2 instance.** Confirm nothing is connected as the app:
   `SELECT application_name, state FROM pg_stat_activity WHERE datname = current_database();`
5. `prisma migrate deploy` (applies the three migrations in order).
6. Start the new build. Check `GET /api/health`, sign in, refresh, upload.
7. Create display variants for existing images (safe online, re-runnable):
   `bun scripts/backfill-display-variants.ts` (dry run), then `--apply`.
   Until then those images are served from their master.

Expected effect on users: web sessions keep working through the cutover;
users whose chain started 60 or more days before it sign in once when the
transition window ends (C + 30 days); anomalous chains (if any) must sign in
again at once. Count them with
`SELECT count(*) FROM "SessionFamily" WHERE "revokeReason" = 'anomaly';` and
`SELECT count(*) FROM "SessionFamily" f, "SystemMarker" m WHERE m."key" = 'legacyCutoverAt' AND f."revokedAt" IS NULL AND f."absoluteExpiresAt" = m."value" + interval '30 days';`.

## Recovering from a failed migration

`migrate deploy` exits with `P3018` and leaves a failed row in
`_prisma_migrations`; the database itself is unchanged. Later deploys refuse
with `P3009` until the failure is resolved:

```bash
prisma migrate resolve --rolled-back <migration_name>
# fix the cause (e.g. a reviewed remediation for duplicate links), then
prisma migrate deploy
```

Until then the Phase 2 build can be restarted (path R-A).

## Rollback paths

| Path | When | Steps | Result |
|---|---|---|---|
| R-A | the migration failed | restart the Phase 2 build | unchanged database |
| R-B | migrated, the new build served no traffic | stop the new build → `down-session-families.sql` → start Phase 2 | as before the cutover |
| R-C | migrated, the new build served traffic | same steps — **incident procedure** | web sessions keep working; logged-out, reused and expired sessions stay rejected; mobile sessions are revoked; families, encrypted successors and device names are lost; user data is kept |
| R-D | restore the pre-cutover backup after traffic | — | **unsafe**: loses every change since the cutover. Disaster recovery only |

Run the down script as one transaction:

```bash
psql --single-transaction -v ON_ERROR_STOP=1 -f docs/database/rollback/down-session-families.sql "$DATABASE_URL"
```

It refuses to run if `session_families` is not applied or a later migration
is. Since Phase 4 later migrations are applied too; reverse them first, newest
first, with the same command: `down-color-profile-v2.sql`
(`20261009000000_color_profile_v2`: colour-profile version/confidence
columns and the one-profile-per-user index; current profiles stay, the
superseded rows the migration deleted cannot be restored), then
`down-wardrobe-analysis-metadata.sql`
(`20261008000000_wardrobe_analysis_metadata`: which provider/model analysed
each photo and the raw model confidences; item attributes stay), then
`down-ai-usage.sql` (`20261007000000_ai_usage`: AI quota counters). Neither
drops user content. `down-idempotency-keys.sql` and `down-media-variants.sql` are optional
full reversals (Phase 2 ignores the new table and columns); run them after
`down-session-families.sql`, in that order.

Verified against the real Phase 2 build (`tests/integration/phase2-rollback.itest.ts`,
run with `PHASE2_DIR=<built Phase 2 copy>`):

- After `down-session-families.sql` the Phase 2 build's own `prisma migrate
  deploy` succeeds ("No pending migrations to apply"): the two extra applied
  migrations do not block it, so Phase 2 can start with its normal migrate step.
- R-B: existing sessions refresh; register, login, upload, image reads, PATCH,
  item and account deletion work; the schema equals Phase 2 + the media and
  idempotency migrations exactly.
- RB-07: a real Phase 2 chain aged to 200 days gets C + 30 days, a recent one
  its start + 90 days; both refresh after the cutover; the old one expires at
  exactly C + 30 days (test clock), survives as revoked through R-C and roll
  forward, which re-derives every limit from the new cutover.
- R-C: web sessions keep refreshing; logged-out, reuse-revoked and
  absolute-expired sessions are rejected; mobile refresh tokens presented as
  cookies are rejected; images are readable (Phase 2 serves the master);
  deleting an item leaves its display file; account deletion cascades.
- The optional full reversal (session families → idempotency → media) yields
  exactly the Phase 2 schema; each script refuses to run out of order.
- The down script is atomic (an injected failure changes nothing), refuses to
  run without `--single-transaction`, and refuses a second run.
- A Phase 2 build started after the cutover by mistake fails closed: login,
  register and refresh return 500 and write no session; other routes work.

### Roll forward after R-B / R-C

1. Stop the Phase 2 build.
2. `prisma migrate deploy` — only `session_families` is applied again; it
   adopts every chain, including sessions Phase 2 created meanwhile.
3. Start the new build. Mobile users sign in again.
4. `bun scripts/storage-sweep.ts --min-age-minutes=0` (dry run), review, then
   add `--apply` to delete display files Phase 2 left behind.

Limitations after R-C: an access token issued by the new build stays valid
under Phase 2 until it expires (≤ 15 min, same `JWT_SECRET`). After rollback
Phase 2 again slides sessions on every rotation (no 90-day absolute limit for
rows it creates); existing rows keep `expiresAt` capped at their family's
limit, so a legacy family's transition limit holds until Phase 2 rotates it.

A roll forward is a new cutover: `legacyCutoverAt` is read again and every
family's limit is derived from it with the same rule (at most C' + 90 days,
at least C' + 30 days for old chains). Each rollback + roll forward therefore
restarts the transition window; it is an incident procedure, not a way to
extend sessions. Families revoked before the rollback come back revoked
(`migrated`).
