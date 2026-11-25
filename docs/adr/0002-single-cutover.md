# 0002. Switch from the Next.js API to Go in one cutover

- Status: accepted
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan)

## Context

There are no production users or data yet. Running the old and new API side by side
would require bit-identical session handling across two implementations during the
transition, the riskiest part of the port.

## Decision

Build the Go API to completion behind the same contract, prove it with the e2e suite,
session vectors, contract tests and golden vectors, then switch all clients to it at
once (stage B7). Until then the existing backend may serve phone testing on the VPS.

## Consequences

- No mixed operation, no shared-session edge cases during the port.
- The switch is a single, rehearsed step on staging first; rollback is the previous
  deployment.
- If production users exist before B7, this decision must be revisited.

## Alternatives considered

- Strangler routing (endpoint by endpoint through Caddy): useful with live users,
  unnecessary risk without them.
