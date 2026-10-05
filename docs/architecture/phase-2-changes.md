# Phase 2 changes — app foundation

Phase 2 makes the prototype a dependable web application. AI garment
recognition, the outfit engine and the AI stylist are intentionally unchanged
(Phases 3–5).

## Routing and navigation

- Single-screen Zustand navigation replaced by App Router routes:
  `/login`, `/register`, `/`, `/wardrobe`, `/wardrobe/new`, `/wardrobe/[id]`,
  `/outfits` (`?occasion=`), `/stylist` (`?event=`), `/profile`,
  `/profile/color-analysis`. Back, Forward, refresh and deep links work.
- Route groups: `(auth)` (guest pages; signed-in users are sent home) and
  `(app)` (server layout checks the session and redirects to `/login`).
- All in-app URLs come from `src/lib/routes.ts`. Sub-screen back buttons use
  `router.back()` when there is in-app history, otherwise the parent route.
- `loading.tsx`, `error.tsx` (retry), `not-found.tsx` (app + global) and
  `global-error.tsx`. Removed: `src/app/page.tsx`, `src/store/app-store.ts`,
  the placeholder `GET /api` route.

## Responsive shell and accessibility

- `< 768px`: existing bottom navigation (hidden on sub-screens).
  `≥ 768px`: sidebar (icon rail at md, labels at lg); content up to `max-w-5xl`.
  Wardrobe grid, home actions and outfit cards gain md/lg columns.
- Pinch-zoom restored; skip-to-content link; visible focus rings; nav
  landmarks with `aria-current`; external favicon replaced by `/logo.svg`.
- Native `confirm()` replaced by an accessible dialog; deleting the account
  requires typing `O'CHIRISH`. Silent failures on Home and the saved-outfits
  list now show an inline error with retry. The colour picker caps at 5.

## Sessions

- Login/register set two HttpOnly, SameSite=Lax cookies (`Secure` in
  production; `COOKIE_SECURE=0` only for plain-http testing):
  - `atlas_at` — HS256 access JWT, 15 min (`ACCESS_TOKEN_TTL_SECONDS`), claim `sid`.
  - `atlas_rt` — opaque 32-byte refresh token, 30 days
    (`REFRESH_TOKEN_TTL_DAYS`), stored only as a SHA-256 hash in the new
    `Session` table (migration `20261005000000_sessions`). `Path=/` so the
    proxy can renew sessions on page loads.
- Tokens are no longer returned in JSON or stored in `localStorage`.
  `POST /api/v1/auth/refresh` rotates the refresh token;
  `POST /api/v1/auth/logout` revokes the session (idempotent).
- Rotation is transactional. A rotated token presented again:
  - within 30 s and the replacement session is live → a fresh access token
    for the replacement session only (concurrent tabs / page load + API call);
  - after 30 s → treated as theft: all of the user's sessions are revoked.
  A token revoked by logout is simply rejected (a stale tab cannot log out
  every device).
- `src/proxy.ts` (Next 16 replacement for `middleware.ts`, Node runtime):
  redirects unauthenticated page requests to `/login?next=…`, rotates the
  session on page loads when only the refresh cookie is valid, never rotates
  on router prefetches (returns 204 instead), rejects cross-origin
  state-changing API requests that carry session cookies (403), and adds
  `x-request-id`.
- The API client retries once after a single-flight refresh on 401; if that
  fails it sends the user to `/login?next=…&expired=1`.
- `JWT_REFRESH_SECRET` is no longer used. Bearer tokens are still accepted by
  the API for future non-browser clients (e.g. Flutter).
- Post-login redirects go through one strict `safeNextPath` (rejects
  `//host`, backslashes, control characters, auth pages) shared by client and
  proxy — fixes an open redirect via `?next=/%09/evil.com`.

## API contract and validation

- Every route is wrapped in `withApi` (`src/server/http.ts`). Errors:
  `{ error, code, details?, requestId }`; unexpected errors are logged and
  returned as `500 INTERNAL` without internals. Validation messages are Uzbek
  (Zod `uz` locale); schema-specific messages take precedence.
- JSON bodies ≤ 64 KB; uploads ≤ 10 MB with `Content-Length` required and
  `multipart/form-data` enforced, checked before the body is read.
- Garment attributes, occasions and profile preferences are validated against
  the catalogue (`src/server/schemas/catalog.ts`); text fields have length
  limits; query parameters are validated.
- Free-text stylist events are mapped to an occasion only when they match an
  occasion id or label (no more silent engine crash on e.g. "to'y").
- `GET /api/v1/wardrobe/items` supports `?limit` (1–200, default 100) and
  `?cursor`, returning `{ items, nextCursor }`.
- `GET /api/health` returns `{ status, database, version }` (503 when the
  database is unreachable).

## Localization

- `next-intl` without locale-prefixed URLs: `src/i18n/request.ts`,
  `messages/uz.json` (namespaces: common, nav, auth, errors, states).
  `src/i18n/config.ts` documents how to add `ru`/`en` (locale cookie).
- Moved to messages: shell/navigation, auth screen, loading/error/not-found,
  API-client fallbacks. Screen bodies are still hard-coded Uzbek (follow-up).

## Logging and diagnostics

- `src/server/log.ts`: one JSON line per event; redacts passwords, tokens,
  cookies, authorization headers, signed-URL signatures and e-mail addresses.
  `LOG_LEVEL` controls verbosity. Request ids flow from the proxy to error
  responses and logs.

## Tests

- Vitest: 92 tests (sessions, proxy, CSRF, API contract, open-redirect guard,
  plus all Phase 1 regressions).
- Playwright (`e2e/`, `./e2e/run-local.sh`): 32 tests against the production
  build and a real Postgres — auth, session expiry (real 10 s TTL) and refresh
  paths, logout, wardrobe CRUD with Back/Forward/reload, outfit generation and
  saving, navigation and layouts at 375/768/1280 px, zoom, skip link. Two bugs
  were found by these tests and fixed (refresh cookie path; rotation race on
  concurrent requests).
- CI gains an `e2e` job.

## Remaining risks / follow-ups

- Sessions slide: each rotation grants a new 30 days; no absolute maximum age.
- Expired/revoked `Session` rows are never purged (needs a cleanup job).
- If a rotation response is lost entirely (network drop) and the old token is
  presented after the 30 s grace window, all sessions are revoked and the
  user must sign in again.
- Revoked sessions keep API access until their access token expires (≤ 15 min);
  logout clears the cookie immediately.
- Rate limiter is in memory, per process.
- Registration still reveals whether an e-mail exists (409).
- Screen bodies and server error texts are not yet in message files.
- No security headers (CSP, frame-ancestors) on pages yet.
- A file selected before the page finishes hydrating can be lost (observed only
  in automated tests).
