# 0003. The OpenAPI document is the single source of truth

- Status: accepted
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan)

## Context

Three clients (Flutter, web, admin) and one server must agree on every field and error
code. The mobile app's session recovery depends on exact error codes.

## Decision

`docs/api/openapi.json` defines the API. The Go server interface and types are
generated from it (oapi-codegen, strict server), and so is the Dart client. A change
starts in the document; CI fails when generated code is stale or a response does not
match the document.

## Consequences

- Drift between server and clients becomes a build failure instead of a runtime bug.
- Every API change is visible as a document diff for review.

## Alternatives considered

- Code-first (generate the document from server code): couples the contract to one
  implementation, which is exactly what is being replaced.
