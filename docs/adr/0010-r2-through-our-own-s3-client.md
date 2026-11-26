# 0010. Cloudflare R2 through a small S3 client of our own

- Status: accepted
- Date: 2026-11-26
- Decided by: the engineer (within the owner-approved plan, stage B4)

## Context

Images are kept on the local disk or, by one setting, in Cloudflare R2 (stage B4). R2
speaks the S3 API. The server needs five things of it: write an object whole, read one,
delete one, list the objects under a prefix, and remove an owner's objects. Objects are
at most a few megabytes; nothing is uploaded in parts, nothing is presigned (images are
always served through `GET /api/v1/media/...`).

The usual clients are the AWS SDK for Go and minio-go. Each brings many modules into
a server that so far has few dependencies, for the sake of five requests. The MinIO
server, the usual stand-in for tests, has been archived by its maker and is no longer
distributed (its download site answered so on 2026-11-26).

## Decision

- `internal/storage` holds its own client: one signed HTTPS request per operation
  (`PUT`, `GET`, `DELETE` of an object; `ListObjectsV2`), addressed by path
  (`endpoint/bucket/key`), with AWS Signature Version 4 in the `Authorization` header and
  the payload's SHA-256 in the request. No new dependency.
- The signing is checked against the four worked examples of AWS's own documentation
  (their signatures, to the character) and against hand-written canonical forms.
- The driver is checked against a stand-in service inside the tests that verifies
  every request as the real one does: the access key, the signature over the request
  as it arrived (path and query byte for byte), the payload's hash.
- The client never follows a redirect, never retries, reads at most 64 MB of an object
  and 4 KB of an error answer, and reports a failure by the service's status and error
  code only (an S3 error body repeats parts of the request). Keys of any other form
  than ours are refused before a request is made.
- Settings: `STORAGE_DRIVER=r2`, `R2_ENDPOINT` (https; plain http only for a test server
  on the same machine, never in production or staging), `R2_BUCKET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` (`auto`). At start the bucket
  is asked one question: a refusal of the request stops the command; no answer is
  logged and the command starts.

## Consequences

- Few lines to own (about 300) instead of a large dependency to watch; the request the
  server sends is the request that was reviewed.
- What S3 offers beyond the five operations is not there: multipart uploads, retries
  with backoff, checksums other than SHA-256, virtual-hosted addressing. An upload that
  fails is refused and retried by the client app with its idempotency key; files left
  by a failed deletion are removed by the sweep.
- **Not yet verified against a real S3-compatible service.** The stand-in is ours; a
  difference between it and R2 would show only against R2. Before the driver is used
  for users' images it is run against a real bucket: a staging bucket of the owner's
  Cloudflare account (owner decision, 2026-11-26), recorded in the stage's file.
- Should the needs grow (large objects, presigned links), this decision is replaced by
  a client library behind the same `storage.Store` interface.

## Alternatives considered

- **minio-go**: complete and well used; many modules for five requests.
- **AWS SDK for Go v2**: the reference; the largest dependency of the three.
- **Presigned R2 links served directly**: would move image traffic off the server, but
  changes the host and the link format the apps and the contract know.
