#!/bin/sh
# Backs up the database and the uploaded images into deploy/backups/<UTC time>/
# while the stack runs. Copy the folder off the server afterwards: a backup that
# stays on the same disk does not survive the loss of the server.
#
# The images are read from the uploads volume (STORAGE_DRIVER=local) through the
# PostgreSQL image, which has tar; the Go image has no shell. With
# STORAGE_DRIVER=r2 the volume is empty and the images live in the bucket.
set -eu
cd "$(dirname "$0")/.."
dir="deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"
deploy/compose.sh exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$dir/atlas.dump"
deploy/compose.sh run --rm --no-deps -T --entrypoint tar \
  -v atlas_uploads:/uploads:ro postgres -czf - -C /uploads . > "$dir/uploads.tgz"
echo "Backup written to $dir"
