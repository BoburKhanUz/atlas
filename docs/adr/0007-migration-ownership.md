# 0007. Prisma owns the schema until cutover; Go migrations start from a recorded baseline

- Status: accepted; carried out in B7.3 (`lookly migrate`, docs/plan/B7.md)
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan)

## Context

Today Prisma owns the PostgreSQL schema (`apps/web/prisma/migrations`, applied by
`prisma migrate deploy`, with a drift check in CI). The Go backend needs its own
migration tool, and River needs its own tables. Two tools changing one database, or a
"down" file for the whole baseline, can destroy data.

## Decision

- Until stage B7, Prisma remains the only tool that changes the shared schema. The Go
  service reads and writes data but runs no schema migrations on that database.
- In B1 the Go migration directory starts with a baseline equal to the Prisma schema at a
  named commit. CI checks that the two stay equal. The baseline is never run against an
  existing database; it is recorded as applied there. It has no down migration.
- River's tables are created by River's own migrator into their own schema, applied in
  development and staging databases; production only after the owner approves the
  deploy.
- At B7 ownership moves to the Go tool in one step: Prisma's history is frozen, the
  CI drift check moves to Go, and improvement migrations (jsonb, CHECK constraints,
  indexes, database-side ids and timestamps) begin.
- Down migrations are never run in production without a fresh backup and the owner's
  approval. Production schema changes prefer forward fixes.

## Consequences

- No period with two tools editing the same tables.
- Improvements to the schema wait until B7; the Go code must handle the current schema
  (JSON stored as text, client-side ids) until then.

## Alternatives considered

- Switching migration ownership at B0: the Next.js API would then run on a schema it no
  longer controls, for weeks.
