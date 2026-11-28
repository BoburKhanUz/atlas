# 0003. The OpenAPI document is the single source of truth

- Status: accepted; the document is hand-owned since B7.5 (2026-11-28)
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan)

## Context

Three clients (Flutter, web, admin) and one server must agree on every field and error
code. The mobile app's session recovery depends on exact error codes.

## Decision

`docs/api/openapi.json` defines the API for every client and server.

- **Until stage B7** the document is generated from the TypeScript registry
  (`apps/web/src/server/openapi/registry.ts` and its schemas) with
  `bun run openapi:write`; CI's `openapi:check` fails on hand edits. A contract change
  therefore starts in the registry, then `openapi:write`, then the Dart client
  (`apps/mobile/tool/openapi/generate_api.sh`), then the Go server code.
- **From B7** the JSON document becomes hand-owned (the TypeScript registry is deleted
  with the old API). Changes start in the document; the Go server interface and types
  and the Dart client are generated from it, and CI fails when generated code is stale or
  a response does not match.
- The document is OpenAPI 3.1. The Dart generator already needs a preparation step
  (`apps/mobile/tool/openapi/prepare_spec.dart`); B0 starts with a spike to confirm how
  the Go generator handles 3.1 and records the result in a new ADR.

## Consequences

- Drift between server and clients becomes a build failure instead of a runtime bug.
- Every API change is visible as a document diff for review.

## Alternatives considered

- Code-first (generate the document from server code): couples the contract to one
  implementation, which is exactly what is being replaced.
