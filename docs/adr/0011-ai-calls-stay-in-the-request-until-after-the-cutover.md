# 0011. AI calls stay in the request until after the cutover

- Status: accepted
- Date: 2026-11-27
- Decided by: the engineer (within the owner-approved plan, stage B6)

## Context

Three operations wait for an AI provider inside the request: the garment analysis of an
upload (`POST /wardrobe/items`, up to about 30 s with one retry), the stylist's answer
(`POST /stylist/chat`, deadline 50 s) and the optional ranking of generated outfits
(`POST /outfits/generate`, budget 25 s). The audit of the Next.js API listed this as a
defect to fix in Go: "River jobs; the API returns a job state"
(`.claude/skills/lookly-go-backend/references/porting.md`).

The contract (`docs/api/openapi.json`) answers all three synchronously: the upload's
201 carries the detection, the chat's 200 carries the assistant's message. The mobile
app, the web app and the browser specs are written to that. The Go backend replaces the
Next.js API in one step behind the same contract (ADR 0002, ADR 0003).

## Decision

Stage B6 ports the three operations as they are: the provider is called inside the
request, with the same deadlines, retries and refunds. What bounds the cost of waiting
is ported or already there: per-attempt timeouts and one retry, the daily quotas, the
in-flight caps of the upload (B4), the per-user limit of generation (B5), and the
request's own time limit at the gate.

Moving these calls to background jobs with a job state is a change of the contract and
of both clients (a pending state on three screens, polling or push). It is planned as a
stage of its own after the cutover, when there is one server and one place to change.

## Consequences

- B6 changes no screen and no client code; the browser specs for AI run unchanged
  against Go.
- A slow provider still holds a request, a connection and a database-free goroutine for
  up to the deadline. The reverse proxy's timeouts must stay above 60 s for these three
  routes (deployment notes).
- The porting note's row is reworded: not done in B6, with a pointer here.

## Alternatives considered

- **Jobs now, in B6.** Rejected: three contract changes, two client changes and new
  screens inside a stage whose exit criterion is "the same specs pass against Go"; a
  regression could not be told from a difference of the port.
- **Jobs behind the same synchronous contract** (the request waits for its own job).
  Rejected: the waiting is the same, with a queue added; it buys retries the clients
  cannot see.
