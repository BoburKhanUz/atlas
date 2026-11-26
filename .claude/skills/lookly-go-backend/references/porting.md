# Porting the Next.js API to Go

Inventory from the audit of `apps/web` (2026-11-25). Paths are relative to `apps/web`.
Re-read the source before porting a part; this file is a map, not the specification.

## Must reproduce (clients depend on it)

**Transport and envelope**
- JSON body limit 64 KB, multipart 10 MB; enforce the limit while reading, even without
  `Content-Length` (the old code did not — do not copy that).
- Auth: `atlas_at` cookie or `Authorization: Bearer`; when an Authorization header is
  present, cookies are ignored (`src/lib/session.ts`).
- Error envelope and the 31 error codes with fixed statuses (`src/server/http.ts`).
- Request id: accept `[A-Za-z0-9-]{8,64}` from the client, else generate; echo it.
- Media responses carry their own `Content-Security-Policy: default-src 'none'`.

**Client modes**
- `X-Atlas-Client: mobile` → tokens in JSON bodies, never cookies. Otherwise web mode:
  `{user}` plus HttpOnly SameSite=Lax cookies `atlas_at` and `atlas_rt`, Path=/,
  Max-Age rounded up.
- Refresh terminal 401 codes (`INVALID_TOKEN`, `SESSION_EXPIRED`, `SESSION_REVOKED`,
  `REFRESH_REUSED`, `CLIENT_MISMATCH`) clear web cookies; `SESSION_RACE` (401) and
  `SESSION_BUSY` (503, `Retry-After: 1`) keep them.

**Session protocol** (`src/server/session/*`, `docs/architecture/sessions.md`)
- Access JWT HS256, 15 min, capped by the family's absolute lifetime (90 days); refresh
  token 32 random bytes base64url, stored as sha256 hex, 30 days.
- One transaction per refresh: lock the family `FOR UPDATE`, then the session.
- Grace window 60 s returns the same successor (stored AES-256-GCM encrypted, AAD
  `<oldId>|<newId>`); later reuse revokes the family.
- Vectors: `docs/api/client-recovery-vectors.json` (9 vectors).

**Gates and limits**
- Consent gate: every authenticated route except `auth/me`, `legal/consent` and
  `account` deletion answers 403 `CONSENT_REQUIRED` when the user's consent is older
  than the minimum legal version.
- Idempotency-Key on `POST wardrobe/items` and `POST stylist/chat`: unique on
  user + route + key, 24 h. A replay returns the original status (201 for wardrobe items,
  200 for stylist chat) with `Idempotent-Replayed: true`. The same key with a different
  body → 409 `IDEMPOTENCY_KEY_MISMATCH`; a request still running → 409
  `IDEMPOTENCY_IN_PROGRESS`.
- AI quotas per user per Tashkent day: stylist 50, vision 50, outfit explanation 30.
  Charge before the provider call; refund on provider error or invalid output; a
  content-filtered or not-a-garment result stays charged. Quotas apply only when a real
  provider is used; when the outfit-explanation quota is spent the endpoint falls back to
  the deterministic explanation instead of answering 429. A `color_analysis` quota (10)
  is defined but not used yet (see defects).

**Media**
- Accept JPEG, PNG, WebP by decoded content (HEIC/AVIF → 415); ≤ 8 MB; shortest side
  ≥ 256; longest ≤ 8000; ≤ 40 MP.
- Variants: master (never served), `_display.webp` ≤ 1600 px q82, `_thumb.webp` ≤ 400 px
  q75; orientation applied; all metadata dropped.
- Signed URL: `/api/v1/media/<key>?exp=<unix>&sig=base64url(HMAC-SHA256(secret, key + "\n" + exp))`,
  1 h TTL; any failure → 404.

## Must not copy (defects found)

| Defect | Fix in Go |
|---|---|
| Global rate-limit buckets: 100 fake sign-ups block everyone; 10 requests lock any email out | Limits per IP and per account, counted on failure, stored in PostgreSQL |
| Limiter in process memory | PostgreSQL-backed limiter |
| Body limit bypass without Content-Length | `http.MaxBytesReader` on every body |
| No per-user upload or storage cap; colour analysis without quota | Per-user upload rate, storage cap, `color_analysis` quota |
| AI calls inside requests (up to 50 s) | River jobs; the API returns a job state |
| Access token valid 15 min after logout or deletion | Check the session row on every request (indexed) |
| Missing indexes (WardrobeImage.wardrobeItemId, OutfitItem.*, AiConversation.userId, Outfit(userId, createdAt)) | Add in the first improvement migration |
| Unbounded wardrobe/message reads; lists cut at 50 without paging | Cursor pagination everywhere |
| Register race returns 500 | Unique violation → 409 `CONFLICT` |
| Non-transactional multi-writes (profile, feedback) | One transaction |
| Weather: failure → undocumented 500; missing fields cached as 0; "next 6 hours" is hours 00–05; generate bypasses the cache | Typed error code; reject incomplete data; real next-6-hours window; one cached path |
| Unguarded parse of JSON stored as text | `jsonb` columns and typed decoding |
| No scheduled cleanup | River periodic jobs |
| Password reset locks the user's row before the session families: can deadlock with a refresh in flight (answered `SESSION_BUSY`) | Families first, then the user's row `FOR NO KEY UPDATE` (`docs/architecture/sessions.md`) |
| A new reset link deletes the earlier ones before its mail is sent: a failed send leaves the user with no working link | Earlier links end once the new message has left |
| Account deletion removes the images best-effort after the rows; a crash in between leaves them | A purge job queued in the deletion's transaction, retried |
| bcrypt cost 10, silent 72-byte truncation | Cost 12, re-hash on login; reject > 72 bytes when setting or changing a password (not at login) |

## Web coupling to remove at cutover

`src/proxy.ts`, `src/app/(app)/layout.tsx`, `src/app/(auth)/layout.tsx`,
`src/app/consent/page.tsx` and `src/instrumentation.ts` import server modules and the
database directly. They switch to calling the Go API (`/auth/me`, `/auth/refresh`).

## Tests

- Reusable unchanged: 13 Playwright spec files (57 tests), the session vectors, the
  contract. They need the Go mock providers to behave like the TypeScript mocks and the
  mail outbox to keep its file format.
- Rewritten in Go: the ~920 vitest cases (they import TypeScript modules).
