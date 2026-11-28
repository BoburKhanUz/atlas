# Lookly API (Go)

The Lookly backend: the API the phone and the website call (`docs/api/openapi.json`),
which replaced the Next.js API in B7. Design and rules:
`docs/architecture/backend.md`, `.claude/skills/lookly-go-backend/SKILL.md`. Stage plan:
`docs/plan/README.md` (B0–B8).

## Run

The Go toolchain switches itself to the version pinned in `go.mod` (Go 1.26).

```bash
cd apps/api
export LOOKLY_ENV=development
export DATABASE_URL=postgresql://user@localhost:5432/lookly
export JWT_SECRET="$(openssl rand -base64 48)"
export MEDIA_SIGNING_SECRET="$(openssl rand -base64 48)"
export SESSION_ENC_KEY="$(openssl rand -base64 32)"
export STORAGE_LOCAL_DIR=/absolute/path/to/storage/uploads   # where the images are
go run ./cmd/lookly serve
curl -s localhost:8080/api/health
```

The schema (the application's tables and the job queue's), once per database and after
each update; it reads only `LOOKLY_ENV` and `DATABASE_URL` (and the pool and log
settings), no secret:

```bash
go run ./cmd/lookly migrate
```

Background jobs, with the server's environment:

```bash
go run ./cmd/lookly worker
```

The server queues jobs too (password reset mail, removal of a deleted account's
images), so run `migrate` before using those. In development, mail is written to
files (`MAIL_OUTBOX_DIR`, default `./storage/mail-outbox`); nothing is sent.

Configuration variables and their rules: `docs/architecture/backend.md#configuration`.
Database, migrations, queries and jobs: `docs/architecture/backend.md#database`.

## Operator commands

Two tools for the operator that read no configuration, no database and no network,
and one that writes the demo account with the server's settings.

```bash
go run ./cmd/lookly ai-digest <user id> [<user id> ...]    # each id's AI_ROLLOUT_ALLOWLIST digest, one per line
go run ./cmd/lookly ai-monitor --input=api.log [--from=ISO] [--to=ISO] [--baseline=last-week.log] [--json]
DEMO_EMAIL=... DEMO_PASSWORD=... go run -tags nodynamic ./cmd/lookly demo-seed --manifest <file> [--apply] [--reset]
```

- `ai-digest`: the environment holds digests, never user ids (`docs/ai/rollout.md`).
- `ai-monitor`: the AI dashboard and the alerts that fire, from the server's JSON log
  lines (`ai.call`, `ai.request`, `ai.quota`); exit 2 when an alert fires, 0 when none
  does, 1 when a file cannot be read. The thresholds are still the INITIAL ones
  (`docs/ai/monitoring.md`).
- `demo-seed`: the store reviewers' demo account from a manifest and its photos, no AI
  call (`deploy/demo/README.md`, including how to run it in the API container). Dry run
  without `--apply`; `--reset` replaces an existing demo wardrobe. It needs the server's
  configuration (database, storage) and refuses an invalid one; the password comes from
  `DEMO_PASSWORD` and is never printed. Exit 0 ok, 1 a failure, 2 usage or configuration.

## Check

```bash
scripts/generate.sh --check                      # generated code matches docs/api/openapi.json
gofmt -l .                                       # prints nothing
go vet -tags nodynamic ./... && go vet -tags integration,nodynamic ./...
go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 -tags integration,nodynamic ./...
go test -race -tags nodynamic ./...
LOOKLY_TEST_DATABASE_URL=postgresql://user@localhost:5432/lookly_test go test -race -tags integration,nodynamic ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

## Change a query or the schema

- A query: edit `internal/store/queries/*.sql`, run `scripts/generate.sh`.
- The schema: add a goose migration in `migrations/` (the next number; never edit an
  applied one, ADR 0007) and run `scripts/generate.sh` (sqlc reads the migrations).
  Prisma's migrations, kept in `testdata/prisma` for the tests, never change.

## Golden vectors

`testdata/golden/*.json` are inputs and outputs recorded from the TypeScript backend;
the Go code must reproduce them (`.claude/skills/lookly-testing/references/parity.md`).
They are fixed records now: the scripts that wrote them (`apps/web/scripts/golden-*.ts`)
went with the TypeScript backend in B7.6 and are in git history at e57764f. A new case
is written here by hand, from an independent source.

The legal texts the server embeds (`internal/legal/documents.json`) are a copy of the
web app's, written by its script; a test in each app fails when it is stale:

```bash
bun scripts/legal-bundle.ts ../api/internal/legal/documents.json
```

A Go test that fails on a recorded case is a difference to investigate, not a reason to
regenerate. A deliberate difference is listed by name in the test, with its reason.

## Change the contract

The contract is hand-owned (ADR 0003, since B7.5): change `docs/api/openapi.json`, check
it with `bun run openapi:validate` in `apps/web`, run `scripts/generate.sh` here and
`apps/mobile/tool/openapi/generate_api.sh` for the phone. To serve a new operation, add its id to
`internal/httpapi/contract/oapi-codegen.yaml`, remove it from `notYetImplemented` in
`coverage_test.go`, regenerate, and implement the new `Server` method.

## Image

```bash
docker build --build-arg VERSION=<version> apps/api
```

A static binary on `gcr.io/distroless/static-debian12:nonroot` (pinned by digest). `lookly health` is the
Docker health check.
