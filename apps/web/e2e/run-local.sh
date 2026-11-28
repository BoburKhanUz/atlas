#!/usr/bin/env bash
# Local runner of the browser suite: fresh database -> `lookly migrate` ->
# build (if needed) -> playwright (the web app, the Go server and worker, the
# front proxy: playwright.config.ts).
# Usage: E2E_GO_BINARY=<built lookly> e2e/run-local.sh [playwright args...]   (FORCE_BUILD=1 to rebuild)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${E2E_GO_BINARY:?set E2E_GO_BINARY to the built lookly binary (cd apps/api && go build -tags nodynamic -o <path> ./cmd/lookly)}"
PGHOST_DIR="${PGHOST_DIR:-/var/tmp/atlas-pg}"
PGPORT_NUM="${PGPORT_NUM:-55432}"
PGUSER_NAME="${PGUSER_NAME:-atlas}"
E2E_DB="${E2E_DB:-atlas_e2e}"

psql -h "$PGHOST_DIR" -p "$PGPORT_NUM" -U "$PGUSER_NAME" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$E2E_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$E2E_DB\""

# Unix-socket style URL for the local trust-auth cluster.
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql://$PGUSER_NAME@localhost:$PGPORT_NUM/$E2E_DB?host=$PGHOST_DIR}"
LOOKLY_ENV=test DATABASE_URL="$E2E_DATABASE_URL" "$E2E_GO_BINARY" migrate >/dev/null

if [ "${FORCE_BUILD:-0}" = "1" ] || [ ! -f .next/standalone/server.js ] || [ ! -d .next/standalone/.next/static ]; then
  NEXT_TELEMETRY_DISABLED=1 bun run build
fi

exec npx playwright test "$@"
