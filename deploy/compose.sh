#!/bin/sh
# docker compose with the base file, the server overlay and deploy/server.env.
# Usage (from any directory): deploy/compose.sh up -d --build | ps | logs -f web
set -eu
cd "$(dirname "$0")/.."
if [ ! -f deploy/server.env ]; then
  echo "deploy/server.env is missing: copy deploy/server.env.example and fill it in (docs/deploy/staging.md)" >&2
  exit 1
fi
exec docker compose -f docker-compose.yml -f deploy/compose.server.yml --env-file deploy/server.env "$@"
