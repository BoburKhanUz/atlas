#!/usr/bin/env bash
# Regenerates the code derived from the API contract (docs/api/openapi.json,
# oapi-codegen) and from the SQL (migrations/ and internal/store/queries/,
# sqlc).
#   scripts/generate.sh          write the generated files
#   scripts/generate.sh --check  fail if a generated file is stale (CI)
set -euo pipefail
cd "$(dirname "$0")/.."

sqlc_version=v1.31.1
generated=(internal/httpapi/contract/contract.gen.go internal/store)

generate() {
  (cd internal/httpapi/contract && go generate ./...)
  # sqlc never deletes the file of a removed query file: start clean.
  find internal/store -maxdepth 1 -name '*.go' ! -name 'doc.go' -delete
  go run "github.com/sqlc-dev/sqlc/cmd/sqlc@${sqlc_version}" generate
}

if [[ "${1:-}" == "--check" ]]; then
  before=$(mktemp -d)
  trap 'rm -rf "$before"' EXIT
  for path in "${generated[@]}"; do
    mkdir -p "$before/$(dirname "$path")"
    cp -r "$path" "$before/$path"
  done
  restore() {
    for path in "${generated[@]}"; do
      rm -rf "$path"
      cp -r "$before/$path" "$path"
    done
  }
  # A failed generation must not leave the tree half-written.
  if ! generate; then
    restore
    echo "generation failed" >&2
    exit 1
  fi
  stale=0
  for path in "${generated[@]}"; do
    if ! diff -r -q "$before/$path" "$path" >/dev/null; then
      echo "stale: $path" >&2
      stale=1
    fi
  done
  restore
  if [[ $stale == 1 ]]; then
    echo "generated code is stale: run apps/api/scripts/generate.sh and commit the result" >&2
    exit 1
  fi
  echo "generated code is current"
  exit 0
fi
generate
echo "wrote ${generated[*]}"
