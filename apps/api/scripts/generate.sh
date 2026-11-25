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
  go run "github.com/sqlc-dev/sqlc/cmd/sqlc@${sqlc_version}" generate
}

if [[ "${1:-}" == "--check" ]]; then
  before=$(mktemp -d)
  trap 'rm -rf "$before"' EXIT
  for path in "${generated[@]}"; do
    mkdir -p "$before/$(dirname "$path")"
    cp -r "$path" "$before/$path"
  done
  generate
  stale=0
  for path in "${generated[@]}"; do
    if ! diff -r -q "$before/$path" "$path" >/dev/null; then
      echo "stale: $path" >&2
      stale=1
    fi
    rm -rf "$path"
    cp -r "$before/$path" "$path"
  done
  if [[ $stale == 1 ]]; then
    echo "generated code is stale: run apps/api/scripts/generate.sh and commit the result" >&2
    exit 1
  fi
  echo "generated code is current"
  exit 0
fi
generate
echo "wrote ${generated[*]}"
