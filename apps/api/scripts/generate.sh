#!/usr/bin/env bash
# Regenerates code derived from the API contract (docs/api/openapi.json).
#   scripts/generate.sh          write the generated files
#   scripts/generate.sh --check  fail if a generated file is stale (CI)
set -euo pipefail
cd "$(dirname "$0")/.."

dir=internal/httpapi/contract
if [[ "${1:-}" == "--check" ]]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  cp "$dir/contract.gen.go" "$tmp/before.go"
  (cd "$dir" && go generate ./...)
  if ! cmp -s "$tmp/before.go" "$dir/contract.gen.go"; then
    cp "$tmp/before.go" "$dir/contract.gen.go"
    echo "contract.gen.go is stale: run apps/api/scripts/generate.sh and commit the result" >&2
    exit 1
  fi
  echo "generated code is current"
  exit 0
fi
(cd "$dir" && go generate ./...)
echo "wrote $dir/contract.gen.go"
