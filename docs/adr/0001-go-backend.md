# 0001. Rewrite the backend in Go as a separate service

- Status: accepted
- Date: 2026-11-25
- Decided by: the owner

## Context

The API lives inside the Next.js web app (`apps/web/src/app/api/v1`). The owner does
not accept a backend embedded in the web framework. An audit (2026-11-25) also found
defects worth fixing rather than carrying forward: in-memory and global rate limits,
AI calls inside requests, tokens valid after logout, missing indexes and pagination.

## Decision

Build a separate Go service in `apps/api` that implements the existing contract
(`docs/api/openapi.json`) on the existing PostgreSQL database. Next.js keeps only the
web UI and the admin panel. All code is written by Claude Code, so local hiring
availability was not a deciding factor.

## Consequences

- About 13,600 lines of TypeScript backend logic are re-implemented; ~920 TypeScript
  unit and regression tests are rewritten in Go. The 57 Playwright e2e tests and the
  session vectors are reused unchanged as the acceptance suite.
- Strong typing, generated contract types and a single static binary make drift and
  deployment errors less likely.
- Admin panel, queues and storage drivers are built in-house (no framework batteries).

## Alternatives considered

- Keep and harden the Next.js API: fastest, but the owner rejected the architecture.
- Laravel: more built-in infrastructure and easier hiring in Uzbekistan; its main extra
  (the Filament admin panel) fell away when the owner chose a Next.js admin panel.
- NestJS: reuses TypeScript code but keeps the backend in the same ecosystem the owner
  wanted to leave.
