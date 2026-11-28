#!/bin/sh
# docker compose with the base file, the server overlay and deploy/server.env.
# Usage (from any directory): deploy/compose.sh up -d --build --wait | ps | logs -f api
set -eu
cd "$(dirname "$0")/.."
if [ ! -f deploy/server.env ]; then
  echo "deploy/server.env is missing: copy deploy/server.env.example and fill it in (docs/deploy/staging.md)" >&2
  exit 1
fi
# A server runs as staging or production only: development would allow the mock
# AI, mail written to files and cookies without Secure on a public address.
env=$(sed -n 's/^LOOKLY_ENV=//p' deploy/server.env | tail -n 1)
case "$env" in
  staging | production) ;;
  *)
    echo "deploy/server.env: LOOKLY_ENV must be staging or production, not '$env'" >&2
    exit 1
    ;;
esac
# The build's version, shown by GET /api/health: the checked-out commit.
LOOKLY_VERSION="${LOOKLY_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
export LOOKLY_VERSION
exec docker compose -f docker-compose.yml -f deploy/compose.server.yml --env-file deploy/server.env "$@"
