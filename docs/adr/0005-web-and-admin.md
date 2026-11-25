# 0005. Next.js serves the web app and the admin panel as UI only

- Status: accepted
- Date: 2026-11-25
- Decided by: the owner (admin in Next.js), the engineer (routing)

## Context

After the Go cutover the web app must not reach the database or server modules
directly. The owner chose to build the admin panel in Next.js rather than a framework
admin.

## Decision

Next.js renders the user web app and `/admin`. It calls the Go API only. Caddy serves
both on one origin (`lookly.uz/api/*` to Go, everything else to Next.js) so web cookies
stay same-origin. The admin panel uses a separate admin API in Go with a server-checked
admin role, TOTP, short sessions and an audit log.

## Consequences

- Five web files that import server modules today are rewritten to call the API.
- Admin features cost about a week instead of the 2–3 days of a framework admin, in
  exchange for full control of its design.

## Alternatives considered

- Filament (Laravel admin): not applicable with a Go backend, and declined by the owner.
- A separate admin domain: an extra origin and cookie scope without a need for it.
