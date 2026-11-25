# Lookly security checklists

Answer each item yes/no for the areas a change touches. A "no" is a finding.

## Sessions and authentication

- [ ] Passwords hashed with bcrypt cost ≥ 12 (older hashes re-hashed after login); passwords over 72 bytes rejected when set or changed, never at login.
- [ ] Login and reset answers do not reveal whether an email exists (same message, similar timing).
- [ ] Rate limits are per IP and per account, counted on failures, stored durably, and cannot lock out other users.
- [ ] Access tokens: fixed algorithm (HS256), issuer and expiry checked, `none` refused; the session row is checked on every request so logout and deletion take effect at once.
- [ ] Refresh rotation follows `docs/architecture/sessions.md`; reuse after the grace window revokes the family; vectors in `docs/api/client-recovery-vectors.json` pass.
- [ ] Reset tokens are random, single-use, short-lived, stored hashed; using one revokes all sessions.
- [ ] Account deletion removes the user's rows and files, and nothing keeps working with the old tokens.

## Uploads and media

- [ ] Body size limited while reading (`http.MaxBytesReader`), not only by `Content-Length`.
- [ ] File type decided from decoded content, not the name or the client's MIME type; only JPEG, PNG, WebP.
- [ ] Dimension and pixel-count limits checked before full decode (decompression bombs).
- [ ] Metadata (EXIF, GPS) removed from every stored variant; orientation applied first.
- [ ] Per-user upload rate and storage cap enforced.
- [ ] Storage keys are server-generated, never built from user input; no path traversal.
- [ ] Signed URLs: HMAC over key and expiry, constant-time comparison, short expiry, 404 on any failure, `Content-Security-Policy: default-src 'none'` and `nosniff` on responses.

## AI integration

- [ ] User text and stored user data reach the model only as data in a separate, structured part of the request, never concatenated into the system prompt.
- [ ] The prompt tells the model the context is data; the code does not rely on that alone.
- [ ] Model output is parsed against a strict schema and validated against the catalog and the user's own items; anything else is refused (and the quota refunded per the rules).
- [ ] Output never triggers actions, URLs, SQL or file access; it is only displayed or stored as text.
- [ ] No ids, emails or other users' data in the context; selfies are not stored.
- [ ] Prompt and output are not logged; telemetry is content-free.
- [ ] Production refuses mock providers and unknown providers at startup.
- [ ] Prompt-injection regression tests cover the stylist and outfit paths.

## Quotas and abuse

- [ ] Every AI feature charges a quota before the provider call and refunds on provider error or invalid output.
- [ ] Expensive endpoints (upload, analysis, colour profile, generate, chat) have per-user limits.
- [ ] Idempotency keys are scoped to user and route and expire.

## Web cookies and CSRF

- [ ] Session cookies are HttpOnly, Secure in production, SameSite=Lax, Path=/.
- [ ] State-changing cookie-authenticated requests check `Origin` (and reject a mismatch); Bearer requests are exempt.
- [ ] Security headers: HSTS (Caddy), `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors none, a CSP for web pages.
- [ ] No CORS wildcard; the API serves the web app from the same origin.

## Flutter storage and transport

- [ ] Tokens only in `flutter_secure_storage`; nothing sensitive in shared preferences, logs or crash reports.
- [ ] iOS Keychain survives reinstall: clear stored tokens on the first launch after install.
- [ ] Release builds use HTTPS only (no cleartext on Android, no ATS or local-networking exceptions on iOS).
- [ ] Logged-out state wipes tokens and cached user data.

## Admin

- [ ] Separate admin role checked on the server for every admin route (tested).
- [ ] TOTP second factor; short admin sessions.
- [ ] Every admin action written to an audit log (who, what, when, target).
- [ ] Destructive actions require confirmation and are rate-limited.

## Secrets and CI

- [ ] No secret in the repository (gitleaks clean), in workflow logs, or in build artifacts.
- [ ] Workflows have least-privilege `permissions:`, pinned third-party actions, no `pull_request_target` with checkout of untrusted code (zizmor and actionlint clean).
- [ ] Dependencies scanned (`govulncheck`, `npm audit`, OSV); new dependencies justified.
