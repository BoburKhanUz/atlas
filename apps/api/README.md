# Lookly API (Go)

The Go backend that replaces the Next.js API with the same contract. Design and rules:
`docs/architecture/backend.md`, `.claude/skills/lookly-go-backend/SKILL.md`. Stage plan:
`docs/plan/README.md` (B0–B8).

## Run

The Go toolchain switches itself to the version pinned in `go.mod` (Go 1.26).

```bash
cd apps/api
LOOKLY_ENV=development DATABASE_URL=postgresql://user@localhost:5432/lookly go run ./cmd/lookly serve
curl -s localhost:8080/api/health
```

Configuration variables and their rules: `docs/architecture/backend.md#configuration`.

## Check

```bash
scripts/generate.sh --check                      # generated code matches docs/api/openapi.json
gofmt -l .                                       # prints nothing
go vet ./... && go vet -tags integration ./...
go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 -tags integration ./...
go test -race ./...
LOOKLY_TEST_DATABASE_URL=postgresql://user@localhost:5432/lookly_test go test -race -tags integration ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

## Change the contract

Until B7 the contract is generated from the TypeScript registry (ADR 0003): change
`apps/web/src/server/openapi/registry.ts`, run `bun run openapi:write` in `apps/web`, then
`scripts/generate.sh` here. To serve a new operation, add its id to
`internal/httpapi/contract/oapi-codegen.yaml`, remove it from `notYetImplemented` in
`coverage_test.go`, regenerate, and implement the new `Server` method.

## Image

```bash
docker build --build-arg VERSION=<version> apps/api
```

A static binary on `gcr.io/distroless/static-debian12:nonroot` (pinned by digest). `lookly health` is the
Docker health check.
