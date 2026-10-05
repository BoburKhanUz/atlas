#!/usr/bin/env bash
# Local e2e runner: fresh DB -> migrate -> build (if needed) -> playwright.
# Usage: e2e/run-local.sh [playwright args...]     (FORCE_BUILD=1 to rebuild)
set -euo pipefail
cd "$(dirname "$0")/.."

PGHOST_DIR="${PGHOST_DIR:-/var/tmp/atlas-pg}"
PGPORT_NUM="${PGPORT_NUM:-55432}"
PGUSER_NAME="${PGUSER_NAME:-atlas}"
E2E_DB="${E2E_DB:-atlas_e2e}"

psql -h "$PGHOST_DIR" -p "$PGPORT_NUM" -U "$PGUSER_NAME" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$E2E_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$E2E_DB\""

# Unix-socket style URL for the local trust-auth cluster.
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql://$PGUSER_NAME@localhost:$PGPORT_NUM/$E2E_DB?host=$PGHOST_DIR}"
DATABASE_URL="$E2E_DATABASE_URL" npx prisma migrate deploy >/dev/null

if [ "${FORCE_BUILD:-0}" = "1" ] || [ ! -f .next/standalone/server.js ] || [ ! -d .next/standalone/.next/static ]; then
  DATABASE_URL="$E2E_DATABASE_URL" NEXT_TELEMETRY_DISABLED=1 bun run build
fi

# Random per-run secrets (never printed).
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
export MEDIA_SIGNING_SECRET="${MEDIA_SIGNING_SECRET:-$(openssl rand -hex 32)}"
export SESSION_ENC_KEY="${SESSION_ENC_KEY:-$(openssl rand -base64 32)}"
export STORAGE_LOCAL_DIR="${STORAGE_LOCAL_DIR:-$(mktemp -d -t atlas-e2e-storage.XXXXXX)}"

exec npx playwright test "$@"
