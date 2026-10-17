#!/bin/sh
# Backs up the database and the uploaded images into deploy/backups/<UTC time>/
# while the stack runs. Copy the folder off the server afterwards: a backup that
# stays on the same disk does not survive the loss of the server.
set -eu
cd "$(dirname "$0")/.."
dir="deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"
deploy/compose.sh exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$dir/atlas.dump"
deploy/compose.sh exec -T web tar -czf - -C /app/storage/uploads . > "$dir/uploads.tgz"
echo "Backup written to $dir"
